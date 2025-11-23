import { BTStatus, Node, TickContext, CandidateAction } from './types'

// 行为树基础节点实现：Selector/Sequence/ConditionNode/ActionNode

export class Selector implements Node {
  constructor(private children: Node[]) {}
  tick(ctx: TickContext): BTStatus {
    for (const child of this.children) {
      const r = child.tick(ctx)
      if (r === 'success' || r === 'running') return r
    }
    return 'failure'
  }
}

export class Sequence implements Node {
  constructor(private children: Node[]) {}
  tick(ctx: TickContext): BTStatus {
    for (const child of this.children) {
      const r = child.tick(ctx)
      if (r === 'failure') return 'failure'
      if (r === 'running') return 'running'
    }
    return 'success'
  }
}

export class ConditionNode implements Node {
  constructor(private predicate: (ctx: TickContext) => boolean) {}
  tick(ctx: TickContext): BTStatus {
    return this.predicate(ctx) ? 'success' : 'failure'
  }
}

export class ActionNode implements Node {
  constructor(private decide: (ctx: TickContext) => CandidateAction | undefined) {}
  tick(ctx: TickContext): BTStatus {
    const cand = this.decide(ctx)
    if (!cand) return 'failure'
    ctx.blackboard.selectedAction = cand
    return 'success'
  }
}
