import type { CoreMessage } from 'ai';
type Role = 'human' | 'assistant';

interface Entry {
  role: Role;
  content: string;
  time: number;
}

export class Conversation {
  private store = new Map<number, Entry[]>();
  constructor(private limit: number = 10) {}

  add(userId: number, role: Role, content: string) {
    const list = this.store.get(userId) ?? [];
    list.push({ role, content, time: Date.now() });
    if (list.length > this.limit) {
      list.splice(0, list.length - this.limit);
    }
    this.store.set(userId, list);
  }

  history(userId: number) {
    const cutoff = Date.now() - 3600 * 1000;
    const list = (this.store.get(userId) ?? []).filter((e) => e.time >= cutoff);
    return list.map((e) => `{"${e.role}": ${JSON.stringify(e.content)}}`).join('\n');
  }

  buildPrompt(userId: number, systemPrompt: string, input: string) {
    const past = this.history(userId);
    const historyBlock = past ? `\n对话历史：\n${past}\n` : '\n';
    return `${systemPrompt}${historyBlock}用户：${input}\n请用上述角色设定自然、简短地回复。`;
  }

  getMessages(userId: number, input: string): CoreMessage[] {
    const cutoff = Date.now() - 3600 * 1000;
    const list = (this.store.get(userId) ?? []).filter((e) => e.time >= cutoff);
    const history: CoreMessage[] = list.map((e) => ({
      role: e.role === 'human' ? 'user' : 'assistant',
      content: e.content,
    }));
    return [
      ...history,
      { role: 'user', content: input },
    ];
  }
}
