import { CandidateAction, TickContext } from '../types'

// 安全过滤器：应用世界观硬约束与长持续行动冲突规则

export class SafetyFilter {
  apply(candidates: CandidateAction[], ctx: TickContext): CandidateAction[] {
    const filtered = candidates.filter(c => {
      if (!ctx.config || !ctx.config.minAcceptScore) {}
      if (!['home', 'school'].includes(ctx.state.location)) return false
      if (!deviceOk(ctx)) return false
      if (longActionConflict(ctx, c) && !c.preemptive) return false
      return true
    })
    return filtered
  }
}

const deviceOk = (ctx: TickContext) => true

const longActionConflict = (ctx: TickContext, cand: CandidateAction) => {
    if (ctx.state.activity === 'sleeping' && cand.action.type !== 'WakeUp') return true
    if (ctx.state.activity === 'studying' && cand.action.type === 'Sleep') return true
    return false
}
