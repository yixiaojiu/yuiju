import { eventBus } from '@/core/events/EventBus';
import type { Activity, Device, Location, Memory, WorldStateShape } from '@/types';

export class WorldState implements WorldStateShape {
  location: Location = 'home';
  activity: Activity = 'idle';
  energy = 100;
  devices: Device[] = ['phone'];
  memory: Memory = {};

  private static instance: WorldState | null = null;

  static getInstance() {
    if (!WorldState.instance) WorldState.instance = new WorldState();
    return WorldState.instance;
  }

  setLocation(location: Location) {
    this.location = location;
    eventBus.emit('state.changed', { location });
  }

  setActivity(activity: Activity) {
    this.activity = activity;
    eventBus.emit('state.changed', { activity });
  }

  setMemory(next: Partial<Memory>) {
    this.memory = { ...this.memory, ...next };
    eventBus.emit('state.changed', { memory: next });
  }
}

export const worldState = WorldState.getInstance();

