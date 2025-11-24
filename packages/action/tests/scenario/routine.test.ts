import { describe, it, expect } from 'vitest';
import { worldState } from '../../src/core/state/WorldState';
import { blackboard } from '../../src/core/blackboard/Blackboard';
import { createBehaviourTree } from '../../src/bt';

describe('RoutineFallback', () => {
  it('night triggers sleep at home', () => {
    worldState.setLocation('home');
    worldState.setActivity('idle');
    blackboard.nowOverride = new Date('2025-01-01T22:30:00+08:00').getTime();
    const tree = createBehaviourTree();
    tree.step();
    expect(worldState.activity).toBe('sleeping');
    blackboard.nowOverride = null;
  });
});
