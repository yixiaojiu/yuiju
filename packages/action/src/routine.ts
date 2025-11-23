import { CandidateAction, TickContext, Action } from './types'

// 例行回退规则：睡觉/起床/去学校

const makeAction = (type: string, effects: Action['effects']): Action => ({ type, effects, duration: {} })

export const RoutineFallback = {
  sleep(ctx: TickContext): CandidateAction | undefined {
    if (!isNight(ctx) || ctx.state.location !== 'home' || ctx.state.activity === 'sleeping') return undefined
    const effects: Action['effects'] = (state, time) => ({
      ...state,
      activity: 'sleeping',
      memory: { ...state.memory, lastSleepStart: time }
    })
    return { action: makeAction('Sleep', effects), score: 0.5, source: 'rule' }
  },
  wake(ctx: TickContext): CandidateAction | undefined {
    if (!isMorning(ctx) || ctx.state.activity !== 'sleeping') return undefined
    const effects: Action['effects'] = (state, time) => ({
      ...state,
      activity: 'idle',
      memory: { ...state.memory, lastWake: time }
    })
    return { action: makeAction('WakeUp', effects), score: 0.5, source: 'rule' }
  },
  school(ctx: TickContext): CandidateAction | undefined {
    if (!isWeekday(ctx) || !inWindow(ctx, '07:20', '07:40') || ctx.state.location !== 'home' || ctx.state.activity === 'sleeping') return undefined
    const effects: Action['effects'] = (state, time) => ({
      ...state,
      location: 'school',
      activity: 'studying',
      memory: { ...state.memory, lastArriveSchool: time }
    })
    return { action: makeAction('GoToSchool', effects), score: 0.55, source: 'rule', preemptive: true }
  }
}

const isNight = (ctx: TickContext) => {
  const h = ctx.time.getHours()
  return h >= 22 || h < 6
}

const isMorning = (ctx: TickContext) => {
  const h = ctx.time.getHours()
  return h >= 6 && h < 7
}

const isWeekday = (ctx: TickContext) => {
  const d = ctx.time.getDay()
  return d >= 1 && d <= 5
}

const inWindow = (ctx: TickContext, start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  const t = ctx.time.getHours() * 60 + ctx.time.getMinutes()
  return t >= s && t <= e
}
