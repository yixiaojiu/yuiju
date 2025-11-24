import { tickScheduler } from '@/core/tick/TickScheduler';
import { worldState } from '@/core/state/WorldState';
import { blackboard } from '@/core/blackboard/Blackboard';
import { eventBus } from '@/core/events/EventBus';
import { actionExecutor } from '@/executor/ActionExecutor';
import { createBehaviourTree, type PolicyProvider } from '@/bt/index';

export function createActionSystem(policy?: PolicyProvider) {
  const behaviourTree = createBehaviourTree(policy);
  eventBus.on('tick', () => {
    behaviourTree.step();
  });
  return { scheduler: tickScheduler, worldState, blackboard, eventBus, behaviourTree, executor: actionExecutor };
}

