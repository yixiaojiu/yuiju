import { join } from "node:path";
import {
  readConversationSettings,
  subscribeConversationSettings,
} from "@yuiju/shared/dashboard/conversation-settings";
import { logger } from "@yuiju/shared/logger/logger";
import { get_data_dir } from "@yuiju/shared/utils/path";
import type { Character } from "../character";
import type { ConversationAgentEvent } from "../communication";
import { ConversationLoop } from "./loop";
import type { ConversationScope } from "./message";
import { type OneBotConfig, OneBotConnection } from "./onebot";
import { StickerCollection } from "./sticker";

export class Conversation {
  private readonly connection: OneBotConnection;
  private readonly sessions = new Map<string, ConversationLoop>();
  private stickers!: StickerCollection;
  /** 世界活动许可与人工开关独立；世界通知可能早于会话初始化。 */
  private participationAllowed: boolean | undefined;
  /** 场景独立控制新轮次，不覆盖世界活动许可与每个群的人工开关。 */
  private sceneAllowed = true;
  private stopSettingsSubscription: (() => void) | undefined;
  private stopped = false;

  constructor(
    private readonly character: Character,
    private readonly onebot: OneBotConfig,
  ) {
    this.connection = new OneBotConnection(character.name, onebot);
  }

  /** 独立调试传入已确认的聊天权限；完整运行由主 agent 同步权限后开放聊天。 */
  async start(participationAllowed?: boolean) {
    if (participationAllowed !== undefined) {
      this.participationAllowed = participationAllowed;
    }
    this.stickers = new StickerCollection(
      join(
        await get_data_dir(),
        "characters",
        encodeURIComponent(this.character.id),
        "conversation",
        "stickers",
        `${encodeURIComponent(this.onebot.self_id)}.json`,
      ),
      this.connection,
    );
    // 主动恢复白名单中的会话；不能等第一条新消息才重建 wait。
    for (const group of this.onebot.group_white_list ?? []) {
      const channelId = group.group_id;
      const session = new ConversationLoop(
        { characterId: this.character.id, platform: "onebot", channelId },
        this.onebot.self_id,
        [this.character.name, ...this.character.nicknames],
        this.connection,
        this.character,
        group.collect_training_data,
        this.onebot.bot_ids ?? [],
        group.check_reply_quality,
        this.stickers,
      );
      await session.initialize();
      this.sessions.set(channelId, session);
    }
    this.stopSettingsSubscription = await subscribeConversationSettings(
      this.character.id,
      async () => {
        const settings = await readConversationSettings(this.character.id);
        if (this.stopped) {
          return;
        }
        await Promise.all(
          [...this.sessions].map(([groupId, session]) =>
            session.setEnabled(settings[groupId] ?? true),
          ),
        );
      },
    );
    await this.connection.start(async (channelId, message) => {
      // 入口已严格校验白名单；连接建立期间先记录，resume 后再执行模型。
      await this.sessions.get(channelId)!.receive(message);
    });
    await this.stickers.initialize();
    for (const session of this.sessions.values()) {
      await session.restoreStickerKeys();
    }
    const firstGroup = this.onebot.group_white_list?.[0];
    if (firstGroup) {
      await this.sessions
        .get(firstGroup.group_id)!
        .receiveStickerAnnotations(this.stickers.pending());
    }
    if (this.participationAllowed !== undefined) {
      await this.setParticipationAllowed(this.participationAllowed);
    }
    for (const session of this.sessions.values()) {
      session.resume();
    }
  }

  async stop() {
    this.stopped = true;
    this.stopSettingsSubscription?.();
    this.connection.stopReceiving();
    // 连接保留到所有在途轮次结束，分段发送可以按原决定完成。
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.stop()),
    );
    await this.connection.stop();
    this.sessions.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "群会话停止失败",
      );
    }
  }

  /** 各群独立整理暂停期背景；一个群的模型调用不占用另一个群的执行队列。 */
  async setParticipationAllowed(allowed: boolean): Promise<void> {
    this.participationAllowed = allowed;
    await Promise.all(
      [...this.sessions.values()].map((session) =>
        session.setParticipationAllowed(allowed && this.sceneAllowed),
      ),
    );
  }

  /** 进入与退出场景只修改自己的限制，不解除睡眠或用户关闭。 */
  async setSceneParticipationAllowed(allowed: boolean): Promise<void> {
    this.sceneAllowed = allowed;
    await Promise.all(
      [...this.sessions.values()].map((session) =>
        session.setParticipationAllowed(allowed && this.participationAllowed === true),
      ),
    );
  }

  /** 广播意图，各群独立决定是否表达；同一请求 ID 在各自会话内去重。 */
  async share(event: ConversationAgentEvent): Promise<string> {
    const groups = [...this.sessions];
    if (!groups.length) {
      return "当前没有已连接的 QQ 群，未提交分享。";
    }
    const results = await Promise.allSettled(
      groups.map(([, session]) => session.receiveAgentEvent(event)),
    );
    return results
      .map((result, index) => {
        const channelId = groups[index][0];
        if (result.status === "fulfilled") {
          return `QQ 群 ${channelId}：${result.value}`;
        }
        logger.error("广播分享意图提交失败", { error: result.reason });
        return `QQ 群 ${channelId}：分享意图提交失败，接收结果未确认。`;
      })
      .join("\n");
  }

  /** 决策反馈只交回来源群，群已退出白名单时明确告知未投递。 */
  async receiveAgentEvent(
    scope: ConversationScope,
    event: ConversationAgentEvent,
  ): Promise<string> {
    if (scope.characterId !== this.character.id || scope.platform !== "onebot") {
      throw new Error("事件来源与当前角色的 QQ 会话不匹配");
    }
    const session = this.sessions.get(scope.channelId);
    if (!session) {
      return `未投递：来源 QQ 群 ${scope.channelId} 当前未接入。`;
    }
    return await session.receiveAgentEvent(event);
  }
}
