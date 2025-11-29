import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';
import type { ActionId, SceneId } from '@/types/action';
import { timeConfig } from '@/config/time';

export function resolveScene(): SceneId {
  const hour = worldState.time.hour();
  const minute = worldState.time.minute();
  const loc = charactorState.location;
  const inWindow = (w: { startHour: number; startMinute: number; endHour: number; endMinute: number }) => {
    const m = hour * 60 + minute;
    const s = w.startHour * 60 + w.startMinute;
    const e = w.endHour * 60 + w.endMinute;
    return m >= s && m < e;
  };
  if (inWindow(timeConfig.scenes.morningWindow)) return 'MORNING';
  if (inWindow(timeConfig.scenes.schoolWindow)) return loc === WorldLocation.SCHEOOL ? 'SCHOOL' : 'HOME';
  if (inWindow(timeConfig.scenes.afterSchoolWindow)) return loc === WorldLocation.SCHEOOL ? 'SCHOOL' : 'HOME';
  return 'EVENING';
}

const sceneAllowed: Record<SceneId, ActionId[]> = {
  MORNING: ['WAKE_UP', 'GO_TO_SCHOOL', 'IDLE_AT_HOME'],
  SCHOOL: ['STUDY_AT_SCHOOL', 'GO_HOME'],
  HOME: ['IDLE_AT_HOME', 'GO_TO_SCHOOL', 'SLEEP'],
  EVENING: ['SLEEP', 'IDLE_AT_HOME'],
};

const sceneDefault: Record<SceneId, ActionId> = {
  MORNING: 'WAKE_UP',
  SCHOOL: 'STUDY_AT_SCHOOL',
  HOME: 'IDLE_AT_HOME',
  EVENING: 'SLEEP',
};

export function getAllowedActions(scene: SceneId): ActionId[] {
  return sceneAllowed[scene];
}

export function getDefaultAction(scene: SceneId): ActionId {
  return sceneDefault[scene];
}

export const isEveningHour = () => worldState.time.hour() >= timeConfig.scenes.eveningStartHour;
export const isSchoolHour = () => {
  const h = worldState.time.hour();
  return h >= timeConfig.scenes.schoolWindow.startHour && h < timeConfig.scenes.schoolWindow.endHour;
};

export const atHome = () => charactorState.location === WorldLocation.HOME;
export const atSchool = () => charactorState.location === WorldLocation.SCHEOOL;
export const doing = (act: Activity) => charactorState.activity === act;

const sceneCooldownSec: Record<SceneId, number> = timeConfig.scenes.defaultSceneCooldownSec;

export function getDefaultSceneCooldownSec(scene: SceneId): number {
  return sceneCooldownSec[scene] ?? 60;
}

