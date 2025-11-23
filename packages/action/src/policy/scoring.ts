import { SoftConstraint, WorldState, Action, TickContext, CandidateAction } from '../types'

// 软约束评分：夜间睡眠、早晨起床、工作日与出发时间窗

const inWindow = (time: Date, start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  const t = time.getHours() * 60 + time.getMinutes()
  return t >= s && t <= e
}

export const IsNightSoft: SoftConstraint = {
  name: 'IsNight',
  weight: 1,
  score: (state: WorldState, time: Date, action: Action) => {
    const h = time.getHours()
    if (action.type !== 'Sleep') return 0
    return h >= 22 || h < 6 ? 1 : 0
  }
}

export const IsMorningSoft: SoftConstraint = {
  name: 'IsMorning',
  weight: 1,
  score: (state: WorldState, time: Date, action: Action) => {
    if (action.type !== 'WakeUp') return 0
    const h = time.getHours()
    return h >= 6 && h < 7 ? 1 : 0
  }
}

export const IsWeekdaySoft: SoftConstraint = {
  name: 'IsWeekday',
  weight: 1,
  score: (state: WorldState, time: Date, action: Action) => {
    if (action.type !== 'GoToSchool') return 0
    const d = time.getDay()
    return d >= 1 && d <= 5 ? 1 : 0
  }
}

export const InDepartWindowSoft = (start: string, end: string): SoftConstraint => ({
  name: 'InWindow',
  weight: 1,
  score: (state: WorldState, time: Date, action: Action) => {
    if (action.type !== 'GoToSchool') return 0
    return inWindow(time, start, end) ? 1 : 0
  }
})

export const applySoftConstraints = (
  cands: CandidateAction[],
  ctx: TickContext,
  constraints: SoftConstraint[],
  weights?: Record<string, number>
) => {
  return cands.map(c => {
    const soft = constraints.reduce((sum, sc) => sum + sc.score(ctx.state, ctx.time, c.action) * (weights?.[sc.name] ?? sc.weight), 0)
    return { ...c, score: c.score + soft }
  })
}
