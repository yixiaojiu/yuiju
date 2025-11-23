import { Selector, Sequence, ConditionNode, ActionNode } from './behaviorTree'
import type { TickContext, CandidateAction, Config } from './types'
import { RoutineFallback } from './routine'
import { LLMPolicyProvider } from './policy/llm'
import { SafetyFilter } from './policy/safetyFilter'
import { applySoftConstraints, IsMorningSoft, IsNightSoft, IsWeekdaySoft, InDepartWindowSoft } from './policy/scoring'
import { applyCoolingAndInertia } from './policy/cooling'
import { ActionExecutor } from './executor'

// TickScheduler：每分钟决策入口，整合策略层与行为树分支
export class TickScheduler {
  constructor(private config: Config) {}

  tick(ctx: TickContext) {
    const llm = new LLMPolicyProvider()
    const safety = new SafetyFilter()
    const exec = new ActionExecutor()

    const EmergencyBranch = new ConditionNode(() => false)

    const LLMDrivenBranch = new ActionNode(c => {
      const raw = llm.getCandidates(c)
      const safe = safety.apply(raw, c)
      const soft = applySoftConstraints(safe, c, [IsNightSoft, IsMorningSoft, IsWeekdaySoft, InDepartWindowSoft(c.config.schoolDepartWindow.start, c.config.schoolDepartWindow.end)], {
        IsNight: c.config.softWeights.night,
        IsMorning: c.config.softWeights.morning,
        IsWeekday: c.config.softWeights.weekday,
        InWindow: c.config.softWeights.inWindow
      })
      const cooled = applyCoolingAndInertia(soft, c)
      const chosen = cooled.sort((a, b) => b.score - a.score)[0]
      if (!chosen || chosen.score < c.config.minAcceptScore) return undefined
      return chosen
    })

    const RoutineBranch = new ActionNode(c => {
      const s = RoutineFallback.sleep(c)
      const w = RoutineFallback.wake(c)
      const sch = RoutineFallback.school(c)
      const pool = [s, w, sch].filter(Boolean) as CandidateAction[]
      const chosen = pool.sort((a, b) => b.score - a.score)[0]
      return chosen
    })

    const root = new Selector([EmergencyBranch, LLMDrivenBranch, RoutineBranch])

    const status = root.tick(ctx)
    const cand = ctx.blackboard.selectedAction
    if (status === 'success' && cand) {
      const next = exec.execute(cand.action, ctx)
      ctx.state = next
    }
    return { status, selected: cand }
  }
}
