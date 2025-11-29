import { Activity, WorldLocation } from '@/types/everything';

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
    this.activity = activity;
  }

  public setLocation(location: WorldLocation) {
    if (this.location === location) return;
    this.location = location;
  }

  public reset() {
    this.location = WorldLocation.HOME;
    this.activity = Activity.SLEEPING;
  }
}

export const charactorState = CharactorState.getInstance();
