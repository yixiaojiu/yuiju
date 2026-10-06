import { logger } from "@yuiju/shared/logger/logger";
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
    // 主动恢复白名单中的会话；不能等第一条新消息才重建 wait。
    for (const channelId of new Set(this.onebot.group_white_list ?? [])) {
      const session = new ConversationLoop(
        { characterId: this.character.id, platform: "onebot", channelId },
        this.onebot.self_id,
        [this.character.name, ...this.character.nicknames],
        this.connection,
        this.character,
      );
      await session.initialize();
      this.sessions.set(channelId, session);
    }
    await this.connection.start(async (channelId, message) => {
      // 入口已严格校验白名单；连接建立期间先记录，resume 后再执行模型。
      await this.sessions.get(channelId)!.receive(message);
    });
    for (const session of this.sessions.values()) session.resume();
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

  /** 各群独立整理暂停期背景；一个群的模型调用不占用另一个群的执行队列。 */
  async setParticipationAllowed(allowed: boolean): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.setParticipationAllowed(allowed)),
    );
  }

  /** 广播意图，各群独立决定是否表达；同一请求 ID 在各自会话内去重。 */
  async share(id: string, text: string): Promise<string> {
    const groups = [...this.sessions];
    if (!groups.length) {
      return "当前没有已连接的 QQ 群，未提交分享。";
    }
    const results = await Promise.allSettled(
      groups.map(([, session]) => session.receiveIntention(id, text)),
    );
    return results
      .map((result, index) => {
        const channelId = groups[index][0];
        if (result.status === "fulfilled") {
          return `QQ 群 ${channelId}：${result.value}`;
        }
        logger.error("广播分享意图提交失败", {
          characterId: this.character.id,
          channelId,
          requestId: id,
          error: result.reason,
        });
        return `QQ 群 ${channelId}：分享意图提交失败，接收结果未确认。`;
      })
      .join("\n");
  }
}
