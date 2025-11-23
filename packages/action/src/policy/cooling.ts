import { CandidateAction, TickContext } from '../types'

// 冷却与惰性加权：为候选叠加冷却扣分与当前行动惰性

export const applyCoolingAndInertia = (cands: CandidateAction[], ctx: TickContext) => {
  const now = Date.now()
  return cands.map(c => {
    const last = ctx.blackboard.lastActionTime.get(c.action.type)
    const ttl = ctx.config.cooling.defaultTtlMs
    const cooled = last && now - last < ttl ? -0.5 : 0
    const inertia = ctx.state.activity === 'sleeping' && c.action.type !== 'WakeUp' ? -1 * ctx.config.cooling.inertiaWeight : 0
    const inertiaStudy = ctx.state.activity === 'studying' && c.action.type !== 'GoToSchool' ? -0.5 * ctx.config.cooling.inertiaWeight : 0
    return { ...c, score: c.score + cooled + inertia + inertiaStudy }
  })
}
