import type { Character } from "../character";
import { ConversationLoop } from "./loop";
import { type OneBotConfig, OneBotConnection } from "./onebot";

export class Conversation {
  private readonly connection: OneBotConnection;
  private readonly sessions = new Map<string, ConversationLoop>();

  constructor(
    private readonly character: Character,
    private readonly onebot: OneBotConfig,
  ) {
    this.connection = new OneBotConnection(character.id, character.name, onebot);
  }

  async start() {
    await this.connection.start(async (channelId, message) => {
      let session = this.sessions.get(channelId);
      if (!session) {
        session = new ConversationLoop(
          { characterId: this.character.id, platform: "onebot", channelId },
          this.onebot.self_id,
          [this.character.name, ...this.character.nicknames],
          this.connection,
        );
        this.sessions.set(channelId, session);
      }
      await session.receive(message);
    });
  }

  async stop() {
    this.connection.stopReceiving();
    // 连接保留到所有在途轮次结束，分段发送可以按原决定完成。
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.stop()),
    );
    await this.connection.stop();
    this.sessions.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "群会话停止失败",
      );
  }
}
