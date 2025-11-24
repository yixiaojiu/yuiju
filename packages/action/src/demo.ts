import { createActionSystem } from '@/index';
import { eventBus } from '@/core/events/EventBus';
import { SimplePolicyProvider } from '@/policy/LLMPolicyProvider';

const { scheduler, worldState } = createActionSystem(new SimplePolicyProvider());

eventBus.on('state.changed', (payload) => {
  console.log('state.changed', payload, { location: worldState.location, activity: worldState.activity });
});
eventBus.on('action.started', (a) => {
  console.log('action.started', a);
});
eventBus.on('action.ended', (a) => {
  console.log('action.ended', a);
});
eventBus.on('tick', ({ now }: any) => {
  console.log('tick', now.format('YYYY-MM-DD HH:mm'));
});

scheduler.start();

