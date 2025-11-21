import type { ModelMessage } from 'ai';
type Role = 'user' | 'assistant';

interface Entry {
  role: Role;
  content: string;
  time: number;
}

export class Conversation {
  private store: Entry[] = [];
  constructor(private limit: number = 10) {}

  add(role: Role, content: string) {
    this.store.push({ role, content, time: Date.now() });
    if (this.store.length > this.limit) {
      this.store.splice(0, this.store.length - this.limit);
    }
  }

  getMessages(input: string): ModelMessage[] {
    const cutoff = Date.now() - 3600 * 1000;
    const list = this.store.filter(e => e.time >= cutoff);
    const history: ModelMessage[] = list.map(e => ({
      role: e.role,
      content: e.content,
    }));
    return [...history, { role: 'user', content: input }];
  }
}
