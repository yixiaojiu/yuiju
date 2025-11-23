import { EventEmitter } from 'events'

// 事件总线封装：基于 Node.js EventEmitter 提供发布/订阅

type Handler = (payload: any) => void

export class SimpleEventBus {
  private emitter = new EventEmitter()

  publish(topic: string, payload: any) {
    this.emitter.emit(topic, payload)
  }

  subscribe(topic: string, handler: Handler) {
    this.emitter.on(topic, handler)
    return () => this.emitter.off(topic, handler)
  }
}
