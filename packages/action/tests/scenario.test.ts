import { describe, it, expect, beforeEach } from 'vitest';
import { createBehaviourTree } from '@/bt';
import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import { Activity, WorldLocation } from '@/types/everything';
import dayjs from 'dayjs';
// import { State } from 'mistreevous';

describe('scenario', () => {
  beforeEach(() => {
    charactorState.reset();
    worldState.reset();
  });

  it('wake up', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 07:00:00'));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);

    tree.step();

    expect(charactorState.activity).toBe(Activity.WAKE_UP);
  });

  it('go to school', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 7:00:00'));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.WAKE_UP);

    tree.step();

    expect(charactorState.location).toBe(WorldLocation.SCHEOOL);
  });

  it('study at school', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 7:00:00'));
    charactorState.setLocation(WorldLocation.SCHEOOL);
    charactorState.setActivity(Activity.WAKE_UP);

    tree.step();

    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);
  });

  it('go home from school', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 16:00:00'));
    charactorState.setLocation(WorldLocation.SCHEOOL);
    charactorState.setActivity(Activity.STUDY_AT_SCHOOL);

    tree.step();

    expect(charactorState.location).toBe(WorldLocation.HOME);
  });

  it('idle at home', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 10:00:00'));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);

    tree.step();

    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);
  });

  it('evening sleep', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 19:00:00'));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.IDLE_AT_HOME);

    tree.step();

    expect(charactorState.activity).toBe(Activity.SLEEPING);
  });

  it('a day flow', () => {
    const tree = createBehaviourTree();

    worldState.updateTime(dayjs('2025-01-01 07:00:00'));
    charactorState.setLocation(WorldLocation.HOME);
    charactorState.setActivity(Activity.SLEEPING);

    tree.step();
    expect(charactorState.activity).toBe(Activity.WAKE_UP);

    worldState.updateTime(dayjs('2025-01-01 07:30:00'));
    tree.step();
    expect(charactorState.location).toBe(WorldLocation.SCHEOOL);

    tree.step();
    expect(charactorState.activity).toBe(Activity.STUDY_AT_SCHOOL);

    worldState.updateTime(dayjs('2025-01-01 16:00:00'));
    tree.step();
    expect(charactorState.location).toBe(WorldLocation.HOME);

    worldState.updateTime(dayjs('2025-01-01 17:00:00'));
    tree.step();
    expect(charactorState.activity).toBe(Activity.IDLE_AT_HOME);
    expect(charactorState.location).toBe(WorldLocation.HOME);

    worldState.updateTime(dayjs('2025-01-01 19:00:00'));
    tree.step();
    expect(charactorState.activity).toBe(Activity.SLEEPING);
    expect(charactorState.location).toBe(WorldLocation.HOME);
  });
});
