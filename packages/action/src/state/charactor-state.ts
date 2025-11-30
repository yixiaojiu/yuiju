import { Activity, WorldLocation } from '@/types/everything';
import { logger } from '@/utils/logger';

export class CharactorState {
  public location: WorldLocation = WorldLocation.HOME;
  public activity: Activity = Activity.SLEEPING;

  private static instance: CharactorState | null = null;

  static getInstance() {
    if (!CharactorState.instance) CharactorState.instance = new CharactorState();
    return CharactorState.instance;
  }

  public setActivity(activity: Activity) {
    if (this.activity === activity) return;
    const prev = this.activity;
    this.activity = activity;
    logger.info({ event: 'activity.change', from: prev, to: activity });
  }

  public setLocation(location: WorldLocation) {
    if (this.location === location) return;
    const prev = this.location;
    this.location = location;
    logger.info({ event: 'location.change', from: prev, to: location });
  }

  public reset() {
    this.location = WorldLocation.HOME;
    this.activity = Activity.SLEEPING;
    logger.info({ event: 'state.reset', location: this.location, activity: this.activity });
  }
}

export const charactorState = CharactorState.getInstance();
