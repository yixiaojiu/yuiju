import { CandidateAction, TickContext, Action } from '../types'

// LLM 策略提供者（桩）：按时间与状态生成候选；包含速率限制与缓存

const dedupe = (cands: CandidateAction[]) => {
  const seen = new Set<string>()
  const out: CandidateAction[] = []
  for (const c of cands) {
    if (seen.has(c.action.type)) continue
    seen.add(c.action.type)
    out.push(c)
  }
  return out
}

const withinMs = (now: number, past?: number, ms?: number) => {
  if (!past || !ms) return false
  return now - past < ms
}

const makeAction = (type: string, effects: Action['effects'], preemptive?: boolean, rationale?: string): Action => ({
  type,
  effects,
  duration: {},
  payload: undefined
})

export class LLMPolicyProvider {
  getCandidates(ctx: TickContext): CandidateAction[] {
    const key = 'llm:' + new Date(ctx.time).toISOString().slice(0, 16)
    const cached = ctx.blackboard.llmCache.get(key)
    const now = Date.now()
    if (cached && withinMs(now, cached.time, ctx.config.llmRateLimitMs)) {
      return cached.candidates
    }

    const cands: CandidateAction[] = []
    const hour = ctx.time.getHours()
    const weekday = ctx.time.getDay()

    if (hour >= 22 || hour < 6) {
      const effects: Action['effects'] = (state, time) => ({
        ...state,
        activity: 'sleeping',
        memory: { ...state.memory, lastSleepStart: time }
      })
      cands.push({ action: makeAction('Sleep', effects), score: 0.6, source: 'llm', rationale: '夜间偏好睡眠' })
    }

    if (hour >= 6 && hour < 7 && stateIsSleeping(ctx)) {
      const effects: Action['effects'] = (state, time) => ({
        ...state,
        activity: 'idle',
        memory: { ...state.memory, lastWake: time }
      })
      cands.push({ action: makeAction('WakeUp', effects), score: 0.6, source: 'llm', rationale: '早晨偏好起床' })
    }

    if (weekday >= 1 && weekday <= 5 && hour >= 7 && hour < 8 && ctx.state.location === 'home' && ctx.state.activity !== 'sleeping') {
      const effects: Action['effects'] = (state, time) => ({
        ...state,
        location: 'school',
        activity: 'studying',
        memory: { ...state.memory, lastArriveSchool: time }
      })
      cands.push({ action: makeAction('GoToSchool', effects, true), score: 0.65, source: 'llm', rationale: '工作日早晨去学校' })
    }

    const deduped = dedupe(cands)
    ctx.blackboard.llmCache.set(key, { time: now, candidates: deduped })
    return deduped
  }
}

const stateIsSleeping = (ctx: TickContext) => ctx.state.activity === 'sleeping'
