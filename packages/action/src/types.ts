/**
 * 数字世界中的地点枚举。
 * - 目前仅支持：家（home）、学校（school）
 */
export type Location = 'home' | 'school'
/**
 * 当前进行的活动类型。
 * - idle：空闲
 * - sleeping：睡眠（长持续行动）
 * - studying：在学校学习（长持续行动）
 * - commuting：通勤/前往目的地
 */
export type Activity = 'idle' | 'sleeping' | 'studying' | 'commuting'

/**
 * 设备状态。
 * - phone.hasNewInfo：是否有来自现实世界的新信息（外部事件）
 */
export interface DevicesState {
  phone: { hasNewInfo: boolean }
}

/**
 * 记忆状态，用于软约束与行为参考。
 * - lastSleepStart：最近一次开始睡眠时间
 * - lastWake：最近一次醒来时间
 * - lastArriveSchool：最近一次到达学校时间
 */
export interface MemoryState {
  lastSleepStart?: Date
  lastWake?: Date
  lastArriveSchool?: Date
}

/**
 * 世界状态的统一视图。
 */
export interface WorldState {
  location: Location
  activity: Activity
  energy: number
  devices: DevicesState
  memory: MemoryState
}

/**
 * 行动定义。
 * - type：行动类型标识
 * - payload：可选负载
 * - effects：应用行动对状态的纯函数更新
 * - duration：可选持续时间（长行动记录）
 */
export interface Action {
  type: string
  payload?: any
  effects: (state: WorldState, time: Date) => WorldState
  duration?: { start?: Date; end?: Date }
}

/**
 * 行为树节点返回状态。
 */
export type BTStatus = 'success' | 'failure' | 'running'

/**
 * 每次 tick 的上下文。
 */
export interface TickContext {
  state: WorldState
  time: Date
  blackboard: Blackboard
  eventBus: EventBus
  config: Config
}

/**
 * 行为树节点接口。
 */
export interface Node {
  tick: (ctx: TickContext) => BTStatus
}

/**
 * 决策候选。
 * - score：综合得分（含软约束与冷却惰性等）
 * - source：来源（规则或 LLM）
 * - rationale：可解释理由
 * - preemptive：是否可抢占长持续行动
 */
export interface CandidateAction {
  action: Action
  score: number
  source: 'rule' | 'llm'
  rationale?: string
  preemptive?: boolean
}

/**
 * 软约束定义。
 * - score：返回偏好分（0~1 可加权）
 */
export interface SoftConstraint {
  name: string
  weight: number
  score: (state: WorldState, time: Date, action: Action) => number
}

/**
 * 冷却策略。
 */
export interface CoolingPolicy {
  key: string
  ttlMs: number
}

/**
 * 事件总线接口。
 */
export interface EventBus {
  publish: (topic: string, payload: any) => void
  subscribe: (topic: string, handler: (payload: any) => void) => () => void
}

/**
 * 行为树黑板（跨节点上下文）。
 */
export interface Blackboard {
  selectedAction?: CandidateAction
  llmCache: Map<string, { time: number; candidates: CandidateAction[]; reason?: string }>
  lastActionTime: Map<string, number>
  failures: Map<string, { time: number; reason: string }>
  currentLongAction?: { type: string; start: number }
  cooldownPolicies: CoolingPolicy[]
}

/**
 * 策略与评分配置。
 */
export interface Config {
  timezoneOffsetMinutes: number
  llmRateLimitMs: number
  minAcceptScore: number
  sleepWindow: { start: string; end: string }
  schoolDepartWindow: { start: string; end: string }
  softWeights: { night: number; morning: number; weekday: number; inWindow: number }
  cooling: { inertiaWeight: number; defaultTtlMs: number }
}

/**
 * 世界观约束。
 */
export interface Constraints {
  allowedLocations: Location[]
  allowedDevices: string[]
}
