import dayjs, { Dayjs } from 'dayjs';

export class WorldState {
  public time: Dayjs = dayjs();

  private static instance: WorldState | null = null;

  static getInstance() {
    if (!WorldState.instance) WorldState.instance = new WorldState();
    return WorldState.instance;
  }

  public updateTime(newTime?: Dayjs) {
    this.time = newTime || dayjs();
  }

  public reset() {
    this.time = dayjs();
  }
}

export const worldState = WorldState.getInstance();
