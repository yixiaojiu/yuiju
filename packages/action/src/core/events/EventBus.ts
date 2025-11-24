import { EventEmitter } from 'node:events';

export type EventMap = {
  'state.changed': unknown;
  'action.started': unknown;
  'action.ended': unknown;
  'external.message': unknown;
  'tick': unknown;
};

export class EventBus {
  private emitter = new EventEmitter();

  on<T extends keyof EventMap>(event: T, listener: (payload: EventMap[T]) => void) {
    this.emitter.on(event, listener as (payload: unknown) => void);
  }

  off<T extends keyof EventMap>(event: T, listener: (payload: EventMap[T]) => void) {
    this.emitter.off(event, listener as (payload: unknown) => void);
  }

  emit<T extends keyof EventMap>(event: T, payload: EventMap[T]) {
    this.emitter.emit(event, payload);
  }
}

export const eventBus = new EventBus();

