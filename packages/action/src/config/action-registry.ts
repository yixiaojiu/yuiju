import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';
import type { ActionId, ActionMetadata } from '@/types/action';
import { ActionId as Action, SceneId as Scene } from '@/types/action';
import { isEveningHour, isSchoolHour, atHome, atSchool, doing } from '@/config/scene-policies';
import { timeConfig } from '@/config/time';

const actions: ActionMetadata[] = [
  {
    id: Action.WAKE_UP,
    scenes: [Scene.MORNING, Scene.HOME, Scene.WEEKEND],
    description: '在家醒来，开始新的一天。',
    precondition: () =>
      atHome() &&
      doing(Activity.SLEEPING) &&
      worldState.time.hour() >= timeConfig.actionsTime.wakeUpEarliestHour,
    executor: () => {
      charactorState.setActivity(Activity.WAKE_UP);
    },
    priority: 10,
    cooldownSec: timeConfig.actions.cooldownSec.WAKE_UP,
  },
  {
    id: Action.GO_TO_SCHOOL,
    scenes: [Scene.MORNING, Scene.HOME],
    description: '醒来后从家前往学校。',
    precondition: () => atHome() && doing(Activity.WAKE_UP),
    executor: () => {
      charactorState.setLocation(WorldLocation.SCHOOL);
      charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    },
    priority: 8,
    cooldownSec: timeConfig.actions.cooldownSec.GO_TO_SCHOOL,
  },
  {
    id: Action.STUDY_AT_SCHOOL,
    scenes: [Scene.SCHOOL],
    description: '在学校时间内在学校学习。',
    precondition: () => atSchool() && isSchoolHour() && !doing(Activity.STUDY_AT_SCHOOL),
    executor: () => {
      charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    },
    priority: 9,
    cooldownSec: timeConfig.actions.cooldownSec.STUDY_AT_SCHOOL,
  },
  {
    id: Action.GO_HOME,
    scenes: [Scene.SCHOOL, Scene.EVENING],
    description: '放学后从学校回家。',
    precondition: () => atSchool() && worldState.time.hour() >= timeConfig.gates.goHomeAfterHour,
    executor: () => {
      charactorState.setLocation(WorldLocation.HOME);
      charactorState.setActivity(Activity.IDLE_AT_HOME);
    },
    priority: 7,
    cooldownSec: timeConfig.actions.cooldownSec.GO_HOME,
  },
  {
    id: Action.IDLE_AT_HOME,
    scenes: [Scene.MORNING, Scene.HOME, Scene.EVENING, Scene.WEEKEND],
    description: '在家闲置（未睡觉或学习时）。',
    precondition: () => atHome() && !doing(Activity.IDLE_AT_HOME),
    executor: () => {
      charactorState.setActivity(Activity.IDLE_AT_HOME);
    },
    priority: 3,
    cooldownSec: timeConfig.actions.cooldownSec.IDLE_AT_HOME,
  },
  {
    id: Action.SLEEP,
    scenes: [Scene.EVENING, Scene.HOME, Scene.WEEKEND],
    description: '晚间在家睡觉。',
    precondition: () => atHome() && isEveningHour() && !doing(Activity.SLEEPING),
    executor: () => {
      charactorState.setActivity(Activity.SLEEPING);
    },
    priority: 10,
    cooldownSec: timeConfig.actions.cooldownSec.SLEEP,
  },
];

const registry = new Map<ActionId, ActionMetadata>(actions.map((meta) => [meta.id, meta]));

export function getRegisteredActions() {
  return Array.from(registry.values());
}

export function getAction(id: ActionId): ActionMetadata | undefined {
  return registry.get(id);
}
