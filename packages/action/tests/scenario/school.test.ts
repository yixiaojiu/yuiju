import { describe, it, expect } from 'vitest';
import { worldState } from '../../src/core/state/WorldState';
import { blackboard } from '../../src/core/blackboard/Blackboard';
import { createBehaviourTree } from '../../src/bt';

describe('School routine', () => {
  it('weekday morning window goes to school and study', () => {
    worldState.setLocation('home');
    worldState.setActivity('idle');
    blackboard.nowOverride = new Date('2025-01-02T07:30:00+08:00').getTime();
    const tree = createBehaviourTree();
    tree.step();
    expect(worldState.location).toBe('school');
    expect(worldState.activity).toBe('studying');
    blackboard.nowOverride = null;
  });
});
