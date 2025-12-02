import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';
import type { ActionId, SceneId } from '@/types/action';
import { SceneId as Scene, ActionId as Action } from '@/types/action';
import { timeConfig } from '@/config/time';

export function resolveScene(): SceneId {
  const hour = worldState.time.hour();
  const minute = worldState.time.minute();
  const loc = charactorState.location;
  const isWeekend = [0, 6].includes(worldState.time.day());
  const inWindow = (w: { startHour: number; startMinute: number; endHour: number; endMinute: number }) => {
    const m = hour * 60 + minute;
    const s = w.startHour * 60 + w.startMinute;
    const e = w.endHour * 60 + w.endMinute;
    return m >= s && m < e;
  };
  if (isWeekend) {
    if (inWindow(timeConfig.scenes.morningWindow)) return Scene.WEEKEND;
    if (inWindow(timeConfig.scenes.schoolWindow)) return Scene.WEEKEND;
    if (inWindow(timeConfig.scenes.afterSchoolWindow)) return Scene.WEEKEND;
    return Scene.EVENING;
  }
  if (inWindow(timeConfig.scenes.morningWindow)) return Scene.MORNING;
  if (inWindow(timeConfig.scenes.schoolWindow)) return loc === WorldLocation.SCHOOL ? Scene.SCHOOL : Scene.HOME;
  if (inWindow(timeConfig.scenes.afterSchoolWindow)) return loc === WorldLocation.SCHOOL ? Scene.SCHOOL : Scene.HOME;
  return Scene.EVENING;
}

const sceneAllowed: Record<SceneId, ActionId[]> = {
  [Scene.MORNING]: [Action.WAKE_UP, Action.GO_TO_SCHOOL, Action.IDLE_AT_HOME],
  [Scene.SCHOOL]: [Action.STUDY_AT_SCHOOL, Action.GO_HOME],
  [Scene.HOME]: [Action.IDLE_AT_HOME, Action.GO_TO_SCHOOL, Action.SLEEP],
  [Scene.EVENING]: [Action.SLEEP, Action.IDLE_AT_HOME],
  [Scene.WEEKEND]: [Action.WAKE_UP, Action.IDLE_AT_HOME, Action.SLEEP],
};

const sceneDefault: Record<SceneId, ActionId> = {
  [Scene.MORNING]: Action.WAKE_UP,
  [Scene.SCHOOL]: Action.STUDY_AT_SCHOOL,
  [Scene.HOME]: Action.IDLE_AT_HOME,
  [Scene.EVENING]: Action.SLEEP,
  [Scene.WEEKEND]: Action.IDLE_AT_HOME,
};

export function getAllowedActions(scene: SceneId): ActionId[] {
  return sceneAllowed[scene];
}

export function getDefaultAction(scene: SceneId): ActionId {
  return sceneDefault[scene];
}

export const isEveningHour = () => worldState.time.hour() >= timeConfig.scenes.eveningStartHour;
export const isWeekend = () => [0, 6].includes(worldState.time.day());
export const isSchoolHour = () => {
  const h = worldState.time.hour();
  if (isWeekend()) return false;
  return h >= timeConfig.scenes.schoolWindow.startHour && h < timeConfig.scenes.schoolWindow.endHour;
};

export const atHome = () => charactorState.location === WorldLocation.HOME;
export const atSchool = () => charactorState.location === WorldLocation.SCHOOL;
export const doing = (act: Activity) => charactorState.activity === act;

const sceneCooldownSec: Record<SceneId, number> = timeConfig.scenes.defaultSceneCooldownSec;

export function getDefaultSceneCooldownSec(scene: SceneId): number {
  return sceneCooldownSec[scene] ?? 60;
}
