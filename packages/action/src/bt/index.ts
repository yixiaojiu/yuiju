import { BehaviourTree, State } from 'mistreevous';
import dayjs from 'dayjs';
import { actionExecutor } from '@/executor/ActionExecutor';
import { worldState } from '@/core/state/WorldState';
import { blackboard } from '@/core/blackboard/Blackboard';
import { defaultConfig } from '@/config';
import type { Action } from '@/types';
import { SafetyFilter, defaultConstraints } from '@/safety/SafetyFilter';

export type PolicyProvider = {
  getAction(input: {
    now: dayjs.Dayjs;
    state: typeof worldState;
    memory: typeof worldState.memory;
  }): Promise<Action | null> | Action | null;
};

export function createBehaviourTree(policy?: PolicyProvider) {
  const safety = new SafetyFilter(defaultConstraints);
  const config = defaultConfig;
  const agent = {
    HasExternalInterrupt: () => false,
    IsNightSoft: () => {
      const base = blackboard.nowOverride ? dayjs(blackboard.nowOverride) : dayjs();
      const hour = base.hour();
      return hour >= 22 || hour < 6;
    },
    IsMorningSoft: () => {
      const base = blackboard.nowOverride ? dayjs(blackboard.nowOverride) : dayjs();
      const hour = base.hour();
      return hour >= 6 && hour < 8;
    },
    IsWeekdaySoft: () => {
      const base = blackboard.nowOverride ? dayjs(blackboard.nowOverride) : dayjs();
      const d = base.day();
      return d !== 0 && d !== 6;
    },
    InSchoolWindowSoft: () => {
      const base = blackboard.nowOverride ? dayjs(blackboard.nowOverride) : dayjs();
      const minutes = base.hour() * 60 + base.minute();
      const { startMinutes, endMinutes } = config.schoolWindow!;
      return minutes >= startMinutes && minutes <= endMinutes;
    },
    AtHome: () => worldState.location === 'home',
    NotSleeping: () => worldState.activity !== 'sleeping',
    IsSleeping: () => worldState.activity === 'sleeping',
    StartSleeping: () => {
      const ok = actionExecutor.execute({ type: 'Sleep' });
      return ok ? State.SUCCEEDED : State.FAILED;
    },
    WakeUp: () => {
      const ok = actionExecutor.execute({ type: 'WakeUp' });
      return ok ? State.SUCCEEDED : State.FAILED;
    },
    GoToSchool: () => {
      const ok = actionExecutor.execute({ type: 'GoToSchool' });
      return ok ? State.SUCCEEDED : State.FAILED;
    },
    StudyAtSchool: () => {
      const ok = actionExecutor.execute({ type: 'StudyAtSchool' });
      return ok ? State.SUCCEEDED : State.FAILED;
    },
    LLMPolicyAction: async () => {
      const now = blackboard.nowOverride ? dayjs(blackboard.nowOverride) : dayjs();
      const nowMs = now.valueOf();
      if (!policy) return State.FAILED;
      if (!blackboard.canRequestPolicy(nowMs)) return State.FAILED;
      blackboard.markPolicyRequested(nowMs);
      const act = await policy.getAction({ now, state: worldState, memory: worldState.memory });
      if (!act) return State.FAILED;
      const res = safety.apply(act, worldState);
      if (!res.ok) return State.FAILED;
      const ok = actionExecutor.execute(act);
      return ok ? State.SUCCEEDED : State.FAILED;
    },
  };

  const definition = `root {
    selector {
      sequence {
        condition (HasExternalInterrupt)
      }
      sequence {
        action [LLMPolicyAction]
      }
      sequence {
        condition (IsNightSoft)
        condition (AtHome)
        condition (NotSleeping)
        action [StartSleeping]
      }
      sequence {
        condition (IsMorningSoft)
        condition (IsSleeping)
        action [WakeUp]
      }
      sequence {
        condition (IsWeekdaySoft)
        condition (InSchoolWindowSoft)
        condition (AtHome)
        condition (NotSleeping)
        action [GoToSchool]
        action [StudyAtSchool]
      }
    }
  }`;

  const tree = new BehaviourTree(definition, agent);
  return tree;
}
