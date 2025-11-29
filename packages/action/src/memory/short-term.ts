import type { DecisionId } from '@/types/action';
import { timeConfig } from '@/config/time';

// 简单的短期记忆实现，记录最近 N 次的 {action, reason, ts}
export class ShortTermMemory {
  private buffer: Array<{ action: DecisionId; reason: string; ts: number }> = [];
  private readonly capacity: number;

  constructor(capacity = 10) {
    this.capacity = capacity;
  }

  push(entry: { action: DecisionId; reason: string; ts: number }) {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  list() {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
  }
}

export const shortTermMemory = new ShortTermMemory(timeConfig.memory.shortTermCapacity);
