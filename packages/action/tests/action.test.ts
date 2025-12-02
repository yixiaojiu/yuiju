import { describe, it, expect, beforeEach } from 'vitest';
import dayjs from 'dayjs';
import { getAction, getRegisteredActions } from '@/config/action-registry';
import { worldState } from '@/state/world-state';
import { charactorState } from '@/state/charactor-state';
import { Activity, WorldLocation } from '@/types/everything';
import { timeConfig } from '@/config/time';
import { ActionId, SceneId } from '@/types/action';
import { resolveScene } from '@/config/scene-policies';
import { resolveDecisionCandidates } from '@/config/decision-gates';

/**
 * 场景测试：验证 action-registry 中的每个动作
 * - precondition：在满足前置条件时返回 true；在常见不满足场景返回 false
 * - executor：正确更新角色的 location / activity 状态
 * - cooldownSec：与配置一致
 */

beforeEach(() => {
  // 重置世界与角色状态，保证用例互不影响
  worldState.updateTime(dayjs().hour(6).minute(0).second(0));
  charactorState.reset();
});

describe('action registry integrity', () => {
  it('contains all expected actions', () => {
    const ids = getRegisteredActions().map(a => a.id).sort();
    expect(ids).toEqual(
      [
        ActionId.WAKE_UP,
        ActionId.GO_TO_SCHOOL,
        ActionId.STUDY_AT_SCHOOL,
        ActionId.GO_HOME,
        ActionId.IDLE_AT_HOME,
        ActionId.SLEEP,
      ].sort()
    );
  });
});

describe('WAKE_UP', () => {
  it('precondition passes when at HOME, sleeping and hour >= earliest', () => {
    const meta = getAction(ActionId.WAKE_UP)!;
    worldState.updateTime(dayjs().hour(timeConfig.actionsTime.wakeUpEarliestHour).minute(0));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);
    expect(meta.precondition()).toBe(true);
  });

  it('executor sets activity to WAKE_UP and cooldown matches config', () => {
    const meta = getAction(ActionId.WAKE_UP)!;
    meta.executor();
    expect(charactorState.activity).toBe(Activity.WAKE_UP);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.WAKE_UP);
  });

  it('precondition fails when not sleeping', () => {
    const meta = getAction(ActionId.WAKE_UP)!;
    charactorState.setActivity(Activity.IDLE_AT_HOME);
    expect(meta.precondition()).toBe(false);
  });
});

describe('GO_TO_SCHOOL', () => {
  it('precondition passes when at HOME and activity is WAKE_UP', () => {
    const meta = getAction(ActionId.GO_TO_SCHOOL)!;
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    expect(meta.precondition()).toBe(true);
  });

  it('executor moves to SCHOOL and sets activity STUDY_AT_SCHOOL', () => {
    const meta = getAction(ActionId.GO_TO_SCHOOL)!;
    meta.executor();
    expect(charactorState.location).toBe(WorldLocation.SCHOOL);
    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.GO_TO_SCHOOL);
  });

  it('precondition fails when not at HOME', () => {
    const meta = getAction(ActionId.GO_TO_SCHOOL)!;
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.WAKE_UP);
    expect(meta.precondition()).toBe(false);
  });
});

describe('STUDY_AT_SCHOOL', () => {
  it('precondition passes at SCHOOL during school hours and not already studying', () => {
    const meta = getAction(ActionId.STUDY_AT_SCHOOL)!;
    charactorState.setLocation(WorldLocation.SCHOOL);
    worldState.updateTime(dayjs().hour(timeConfig.scenes.schoolWindow.startHour).minute(0));
    charactorState.setActivity(Activity.WAKE_UP);
    expect(meta.precondition()).toBe(true);
  });

  it('executor sets activity STUDY_AT_SCHOOL', () => {
    const meta = getAction(ActionId.STUDY_AT_SCHOOL)!;
    meta.executor();
    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.STUDY_AT_SCHOOL);
  });

  it('precondition fails when not at SCHOOL', () => {
    const meta = getAction(ActionId.STUDY_AT_SCHOOL)!;
    charactorState.setLocation(WorldLocation.HOME);
    worldState.updateTime(dayjs().hour(timeConfig.scenes.schoolWindow.startHour).minute(0));
    expect(meta.precondition()).toBe(false);
  });
});

describe('GO_HOME', () => {
  it('precondition passes at SCHOOL when hour >= goHomeAfterHour', () => {
    const meta = getAction(ActionId.GO_HOME)!;
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    worldState.updateTime(dayjs().hour(timeConfig.gates.goHomeAfterHour).minute(0));
    expect(meta.precondition()).toBe(true);
  });

  it('executor moves HOME and sets activity IDLE_AT_HOME', () => {
    const meta = getAction(ActionId.GO_HOME)!;
    meta.executor();
    expect(charactorState.location).toBe(WorldLocation.HOME);
    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.GO_HOME);
  });

  it('precondition fails when hour < goHomeAfterHour', () => {
    const meta = getAction(ActionId.GO_HOME)!;
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);
    worldState.updateTime(dayjs().hour(timeConfig.gates.goHomeAfterHour - 1).minute(0));
    expect(meta.precondition()).toBe(false);
  });
});

describe('IDLE_AT_HOME', () => {
  it('precondition passes when at HOME and not already idle', () => {
    const meta = getAction(ActionId.IDLE_AT_HOME)!;
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    expect(meta.precondition()).toBe(true);
  });

  it('executor sets activity IDLE_AT_HOME', () => {
    const meta = getAction(ActionId.IDLE_AT_HOME)!;
    meta.executor();
    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.IDLE_AT_HOME);
  });

  it('precondition fails when already idle', () => {
    const meta = getAction(ActionId.IDLE_AT_HOME)!;
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);
    expect(meta.precondition()).toBe(false);
  });
});

describe('SLEEP', () => {
  it('precondition passes at HOME during evening and not already sleeping', () => {
    const meta = getAction(ActionId.SLEEP)!;
    charactorState.setLocation(WorldLocation.HOME);
    worldState.updateTime(dayjs().hour(timeConfig.scenes.eveningStartHour).minute(0));
    charactorState.setActivity(Activity.IDLE_AT_HOME);
    expect(meta.precondition()).toBe(true);
  });

  it('executor sets activity SLEEPING', () => {
    const meta = getAction(ActionId.SLEEP)!;
    meta.executor();
    expect(charactorState.activity).toBe(Activity.SLEEPING);
    expect(meta.cooldownSec).toBe(timeConfig.actions.cooldownSec.SLEEP);
  });

  it('precondition fails when already sleeping', () => {
    const meta = getAction(ActionId.SLEEP)!;
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);
    worldState.updateTime(dayjs().hour(timeConfig.scenes.eveningStartHour).minute(0));
    expect(meta.precondition()).toBe(false);
  });
});

describe('Weekend behavior', () => {
  it('resolveScene returns WEEKEND during daytime on weekend', () => {
    const saturdayMorning = dayjs('2025-11-29T10:00:00');
    worldState.updateTime(saturdayMorning);
    charactorState.setLocation(WorldLocation.HOME);
    const scene = resolveScene();
    expect(scene).toBe(SceneId.WEEKEND);
  });

  it('no GO_TO_SCHOOL decision gate on weekend', () => {
    const sundayMorning = dayjs('2025-11-30T09:00:00');
    worldState.updateTime(sundayMorning);
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);
    const gate = resolveDecisionCandidates();
    const hasGoToSchool = gate?.candidates.some(c => c.id === ActionId.GO_TO_SCHOOL);
    expect(hasGoToSchool).toBeFalsy();
  });

  it('STUDY_AT_SCHOOL precondition fails on weekend even at school', () => {
    const saturdayNoon = dayjs('2025-11-29T12:00:00');
    worldState.updateTime(saturdayNoon);
    charactorState.setLocation(WorldLocation.SCHOOL);
    charactorState.setActivity(Activity.WAKE_UP);
    const meta = getAction(ActionId.STUDY_AT_SCHOOL)!;
    expect(meta.precondition()).toBe(false);
  });
});
