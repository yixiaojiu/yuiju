import dayjs from 'dayjs';
import { tick } from '@/engine/tick';
import { worldState } from '@/state/world-state';
import { charactorState } from '@/state/charactor-state';
import { timeConfig } from '@/config/time';
import { logger } from '@/utils/logger';

let running = false;
let stopped = false;

export async function startRealtimeLoop() {
  stopped = false;
  if (running) return;
  running = true;

  while (!stopped) {
    worldState.updateTime();
    let delayMs = timeConfig.runner.initialDelayMs;
    try {
      const result = await tick();
      logger.info({
        event: 'tick.result',
        time: worldState.time.format('HH:mm'),
        scene: result.scene,
        executed: result.executed,
        reason: result.reason,
        location: charactorState.location,
        activity: charactorState.activity,
      });
      delayMs = result.nextDelayMs;
    } catch (err: any) {
      logger.error({
        event: 'tick.error',
        time: worldState.time.format('HH:mm'),
        location: charactorState.location,
        activity: charactorState.activity,
        error: String(err),
        stack: err?.stack,
      });
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  running = false;
  process.on('SIGINT', () => {
    stopped = true;
  });
  process.on('SIGTERM', () => {
    stopped = true;
  });
}

export async function simulateDay(
  startHour = timeConfig.simulation.startHour,
  endHour = timeConfig.simulation.endHour,
  stepHours = timeConfig.simulation.stepHours
) {
  charactorState.reset();
  for (let h = startHour; h <= endHour; h += stepHours) {
    worldState.updateTime(dayjs().hour(h).minute(0).second(0));
    const result = await tick();
    logger.info({
      event: 'simulate.result',
      time: `${h}:00`,
      scene: result.scene,
      executed: result.executed,
      reason: result.reason,
      location: charactorState.location,
      activity: charactorState.activity,
    });
  }
}
