import { Action, TickContext, WorldState } from './types'

// 行动执行器：负责发布开始/结束事件并应用 effects 更新状态

export class ActionExecutor {
  start(action: Action, ctx: TickContext) {
    ctx.eventBus.publish('action.started', { action, time: ctx.time })
  }
  end(action: Action, ctx: TickContext) {
    ctx.eventBus.publish('action.ended', { action, time: ctx.time })
  }
  execute(action: Action, ctx: TickContext): WorldState {
    this.start(action, ctx)
    const next = action.effects(ctx.state, ctx.time)
    ctx.eventBus.publish('state.changed', { prev: ctx.state, next, time: ctx.time })
    this.end(action, ctx)
    return next
  }
}
