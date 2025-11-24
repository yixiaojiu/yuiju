import dayjs from 'dayjs';
import { eventBus } from '@/core/events/EventBus';

export class TickScheduler {
  private timer: NodeJS.Timeout | null = null;
  timezoneOffsetHours = 8;

  start() {
    if (this.timer) return;
    const tick = () => {
      const now = dayjs();
      eventBus.emit('tick', { now });
    };
    tick();
    this.timer = setInterval(tick, 60000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const tickScheduler = new TickScheduler();

