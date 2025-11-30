import dayjs, { Dayjs } from 'dayjs';
import { logger } from '@/utils/logger';

export class WorldState {
  public time: Dayjs = dayjs();

  private static instance: WorldState | null = null;

  static getInstance() {
    if (!WorldState.instance) WorldState.instance = new WorldState();
    return WorldState.instance;
  }

  public updateTime(newTime?: Dayjs) {
    this.time = newTime || dayjs();
    logger.debug({ event: 'time.update', iso: this.time.toISOString() });
  }

  public reset() {
    this.time = dayjs();
    logger.info({ event: 'time.reset', iso: this.time.toISOString() });
  }
}

export const worldState = WorldState.getInstance();
