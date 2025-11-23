import { Node, TickContext, BTStatus, CandidateAction, Action } from './types'

// 装饰器：硬守卫与软约束评分组合器

export class HardGuardDecorator implements Node {
  constructor(private node: Node, private guard: (ctx: TickContext) => boolean) {}
  tick(ctx: TickContext): BTStatus {
    if (!this.guard(ctx)) return 'failure'
    return this.node.tick(ctx)
  }
}

export const composeSoftScore = (
  constraints: Array<(ctx: TickContext, action: Action) => number>,
  weights: number[]
) => {
  return (ctx: TickContext, cand: CandidateAction): CandidateAction => {
    const scores = constraints.map(fn => fn(ctx, cand.action))
    const soft = scores.reduce((sum, s, i) => sum + s * (weights[i] || 1), 0)
    return { ...cand, score: cand.score + soft }
  }
}
