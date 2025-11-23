import { TickScheduler } from './scheduler';
import { initialWorldState } from './worldState';
import { createBlackboard } from './blackboard';
import { SimpleEventBus } from './eventBus';
import type { Config } from './types';

// 最小演示入口：回放三个时间点并输出事件与选择

export const runDemo = () => {
  const config: Config = {
    timezoneOffsetMinutes: 480,
    llmRateLimitMs: 60000,
    minAcceptScore: 0.7,
    sleepWindow: { start: '22:30', end: '06:30' },
    schoolDepartWindow: { start: '07:20', end: '07:40' },
    softWeights: { night: 0.4, morning: 0.4, weekday: 0.4, inWindow: 0.5 },
    cooling: { inertiaWeight: 0.7, defaultTtlMs: 300000 },
  };

  const eventBus = new SimpleEventBus();
  eventBus.subscribe('action.started', ({ action, time }) => {
    console.log('action.started', action.type, time.toISOString());
  });
  eventBus.subscribe('action.ended', ({ action, time }) => {
    console.log('action.ended', action.type, time.toISOString());
  });
  eventBus.subscribe('state.changed', ({ prev, next, time }) => {
    console.log(
      'state.changed',
      prev.activity,
      '->',
      next.activity,
      'at',
      time.toISOString(),
      'location',
      next.location
    );
  });

  const state = initialWorldState();
  const blackboard = createBlackboard();
  const scheduler = new TickScheduler(config);
  const ctx = { state, time: new Date(), blackboard, eventBus, config };

  const times = [new Date('2025-11-24T23:00:00'), new Date('2025-11-25T06:10:00'), new Date('2025-11-25T07:30:00')];

  for (const t of times) {
    ctx.time = t;
    const res = scheduler.tick(ctx);
    if (res.selected) {
      blackboard.lastActionTime.set(res.selected.action.type, Date.now());
      console.log('selected', res.selected.action.type, res.selected.score.toFixed(2));
    } else {
      console.log('no-selection', t.toISOString());
    }
  }
};

runDemo();
