import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';
import type { ActionId, ActionMetadata, SceneId } from '@/types/action';
import { isEveningHour, isSchoolHour, atHome, atSchool, doing } from '@/config/scene-policies';
import { timeConfig } from '@/config/time';

const registry = new Map<ActionId, ActionMetadata>();

function register(meta: ActionMetadata) {
  registry.set(meta.id, meta);
}

register({
  id: 'WAKE_UP',
  scenes: ['MORNING', 'HOME'],
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
});

register({
  id: 'GO_TO_SCHOOL',
  scenes: ['MORNING', 'HOME'],
  description: '醒来后从家前往学校。',
  precondition: () => atHome() && doing(Activity.WAKE_UP),
  executor: () => {
    charactorState.setLocation(WorldLocation.SCHEOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
  },
  priority: 8,
  cooldownSec: timeConfig.actions.cooldownSec.GO_TO_SCHOOL,
});

register({
  id: 'STUDY_AT_SCHOOL',
  scenes: ['SCHOOL'],
  description: '在学校时间内在学校学习。',
  precondition: () => atSchool() && isSchoolHour() && !doing(Activity.STUDY_AT_SCHOOL),
  executor: () => {
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
  },
  priority: 9,
  cooldownSec: timeConfig.actions.cooldownSec.STUDY_AT_SCHOOL,
});

register({
  id: 'GO_HOME',
  scenes: ['SCHOOL', 'EVENING'],
  description: '放学后从学校回家。',
  precondition: () => atSchool() && worldState.time.hour() >= timeConfig.gates.goHomeAfterHour,
  executor: () => {
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);
  },
  priority: 7,
  cooldownSec: timeConfig.actions.cooldownSec.GO_HOME,
});

register({
  id: 'IDLE_AT_HOME',
  scenes: ['MORNING', 'HOME', 'EVENING'],
  description: '在家闲置（未睡觉或学习时）。',
  precondition: () => atHome() && !doing(Activity.IDLE_AT_HOME),
  executor: () => {
    charactorState.setActivity(Activity.IDLE_AT_HOME);
  },
  priority: 3,
  cooldownSec: timeConfig.actions.cooldownSec.IDLE_AT_HOME,
});

register({
  id: 'SLEEP',
  scenes: ['EVENING', 'HOME'],
  description: '晚间在家睡觉。',
  precondition: () => atHome() && isEveningHour() && !doing(Activity.SLEEPING),
  executor: () => {
    charactorState.setActivity(Activity.SLEEPING);
  },
  priority: 10,
  cooldownSec: timeConfig.actions.cooldownSec.SLEEP,
});

export function getRegisteredActions() {
  return Array.from(registry.values());
}

export function getAction(id: ActionId): ActionMetadata | undefined {
  return registry.get(id);
}

