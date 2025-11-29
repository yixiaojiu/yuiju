type ActionId =
  | 'WAKE_UP'
  | 'GO_TO_SCHOOL'
  | 'STUDY_AT_SCHOOL'
  | 'GO_HOME'
  | 'IDLE_AT_HOME'
  | 'SLEEP'

type SceneId = 'MORNING' | 'SCHOOL' | 'EVENING' | 'HOME'

type Location = 'HOME' | 'SCHOOL'

type Activity = 'SLEEPING' | 'WAKE_UP' | 'STUDY_AT_SCHOOL' | 'IDLE_AT_HOME'

type WorldState = {
  hour: number
}

type CharacterState = {
  location: Location
  activity: Activity
}

type Precondition = (world: WorldState, char: CharacterState) => boolean
type Executor = (world: WorldState, char: CharacterState) => CharacterState

type ActionMeta = {
  id: ActionId
  scenes: SceneId[]
  description: string
  precondition: Precondition
  executor: Executor
  cooldownMs?: number
  priority?: number
}

type ScenePolicy = {
  id: SceneId
  allowed: ActionId[]
  default: ActionId
}

const ScenePolicies: Record<SceneId, ScenePolicy> = {
  MORNING: {
    id: 'MORNING',
    allowed: ['WAKE_UP', 'GO_TO_SCHOOL', 'IDLE_AT_HOME'],
    default: 'WAKE_UP',
  },
  SCHOOL: {
    id: 'SCHOOL',
    allowed: ['STUDY_AT_SCHOOL', 'GO_HOME'],
    default: 'STUDY_AT_SCHOOL',
  },
  HOME: {
    id: 'HOME',
    allowed: ['IDLE_AT_HOME', 'GO_TO_SCHOOL', 'SLEEP'],
    default: 'IDLE_AT_HOME',
  },
  EVENING: {
    id: 'EVENING',
    allowed: ['SLEEP', 'IDLE_AT_HOME'],
    default: 'SLEEP',
  },
}

const ActionRegistry: Record<ActionId, ActionMeta> = {
  WAKE_UP: {
    id: 'WAKE_UP',
    scenes: ['MORNING', 'HOME'],
    description: 'Wake up at morning at home',
    precondition: (world, char) => world.hour >= 6 && world.hour < 9 && char.activity === 'SLEEPING' && char.location === 'HOME',
    executor: (world, char) => ({ ...char, activity: 'WAKE_UP' }),
    cooldownMs: 10_000,
    priority: 10,
  },
  GO_TO_SCHOOL: {
    id: 'GO_TO_SCHOOL',
    scenes: ['MORNING', 'HOME'],
    description: 'Go from home to school after waking up',
    precondition: (world, char) => char.location === 'HOME' && char.activity === 'WAKE_UP',
    executor: (world, char) => ({ ...char, location: 'SCHOOL' }),
    cooldownMs: 10_000,
    priority: 8,
  },
  STUDY_AT_SCHOOL: {
    id: 'STUDY_AT_SCHOOL',
    scenes: ['SCHOOL'],
    description: 'Study when at school during the day',
    precondition: (world, char) => char.location === 'SCHOOL' && world.hour >= 9 && world.hour < 17,
    executor: (world, char) => ({ ...char, activity: 'STUDY_AT_SCHOOL' }),
    cooldownMs: 5_000,
    priority: 9,
  },
  GO_HOME: {
    id: 'GO_HOME',
    scenes: ['SCHOOL', 'EVENING'],
    description: 'Return home from school when day ends',
    precondition: (world, char) => char.location === 'SCHOOL' && world.hour >= 17,
    executor: (world, char) => ({ ...char, location: 'HOME' }),
    cooldownMs: 10_000,
    priority: 7,
  },
  IDLE_AT_HOME: {
    id: 'IDLE_AT_HOME',
    scenes: ['HOME', 'EVENING'],
    description: 'Idle at home when not sleeping',
    precondition: (world, char) => char.location === 'HOME' && char.activity !== 'SLEEPING',
    executor: (world, char) => ({ ...char, activity: 'IDLE_AT_HOME' }),
    cooldownMs: 5_000,
    priority: 6,
  },
  SLEEP: {
    id: 'SLEEP',
    scenes: ['EVENING', 'HOME'],
    description: 'Sleep at evening at home when idle',
    precondition: (world, char) => char.location === 'HOME' && world.hour >= 21 && char.activity !== 'SLEEPING',
    executor: (world, char) => ({ ...char, activity: 'SLEEPING' }),
    cooldownMs: 20_000,
    priority: 10,
  },
}

type MemoryItem = {
  action: ActionId
  reason: string
  ts: number
}

const ShortTermMemory: MemoryItem[] = []

type LLMChoice = {
  action: ActionId
  reason: string
}

type LLMContext = {
  world: WorldState
  character: CharacterState
  scene: SceneId
  allowed: { id: ActionId; description: string; priority?: number }[]
  memory: MemoryItem[]
}

interface LLMClient {
  chooseAction(context: LLMContext): Promise<LLMChoice>
}

const llm: LLMClient = {
  async chooseAction(context) {
    const fallback = context.allowed.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
    return { action: fallback.id, reason: 'fallback' }
  },
}

function resolveScene(world: WorldState, char: CharacterState): SceneId {
  if (world.hour >= 6 && world.hour < 9) return 'MORNING'
  if (world.hour >= 9 && world.hour < 17) return char.location === 'SCHOOL' ? 'SCHOOL' : 'HOME'
  if (world.hour >= 17 && world.hour < 21) return char.location === 'SCHOOL' ? 'SCHOOL' : 'HOME'
  return 'EVENING'
}

function getAllowedActions(world: WorldState, char: CharacterState, scene: SceneId): ActionMeta[] {
  const policy = ScenePolicies[scene]
  const metas = policy.allowed.map(id => ActionRegistry[id])
  return metas.filter(meta => meta.precondition(world, char))
}

function validateChoice(choice: LLMChoice, allowed: ActionMeta[]): boolean {
  return allowed.some(a => a.id === choice.action)
}

function executeAction(world: WorldState, char: CharacterState, actionId: ActionId): CharacterState {
  const meta = ActionRegistry[actionId]
  const next = meta.executor(world, char)
  return next
}

function remember(choice: LLMChoice): void {
  ShortTermMemory.unshift({ action: choice.action, reason: choice.reason, ts: Date.now() })
  if (ShortTermMemory.length > 10) ShortTermMemory.pop()
}

function fallbackAction(scene: SceneId): ActionId {
  return ScenePolicies[scene].default
}

export async function tick(world: WorldState, char: CharacterState): Promise<CharacterState> {
  const scene = resolveScene(world, char)
  const allowed = getAllowedActions(world, char, scene)
  const context: LLMContext = {
    world,
    character: char,
    scene,
    allowed: allowed.map(a => ({ id: a.id, description: a.description, priority: a.priority })),
    memory: [...ShortTermMemory],
  }
  const choice = await llm.chooseAction(context)
  const valid = validateChoice(choice, allowed)
  const actionId = valid ? choice.action : fallbackAction(scene)
  const next = executeAction(world, char, actionId)
  remember({ action: actionId, reason: valid ? choice.reason : 'fallback' })
  return next
}

export async function demo(): Promise<void> {
  let world: WorldState = { hour: 6 }
  let char: CharacterState = { location: 'HOME', activity: 'SLEEPING' }
  for (const h of [6, 8, 9, 12, 17, 20, 22]) {
    world = { hour: h }
    char = await tick(world, char)
  }
}
