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
import { StickerCollection } from "./sticker/collection";

export class Conversation {
  private readonly connection: OneBotConnection;
  private loop!: ConversationLoop;
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
    this.connection = new OneBotConnection(character, onebot);
  }

  /** 只读提供当前账号的业务实例；HTTP 管理与聊天使用同一份收藏状态。 */
  get stickerCollection(): StickerCollection {
    return this.stickers;
  }

  async synchronizeStickers(): Promise<void> {
    await this.stickers.synchronize();
    await this.loop.receiveStickerAnnotations(this.stickers.pending());
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
    const whitelist = this.onebot.group_white_list ?? [];
    this.loop = new ConversationLoop(
      this.character.id,
      "onebot",
      whitelist.map((group) => ({
        channelId: group.group_id,
        collectTrainingData: group.collect_training_data,
        checkReplyQuality: group.check_reply_quality,
      })),
      this.onebot.self_id,
      [this.character.name, ...this.character.nicknames],
      this.connection,
      this.character,
      this.onebot.bot_ids ?? [],
      this.stickers,
    );
    await this.loop.initialize();

    const initialSettings = await readConversationSettings(this.character.id);
    await Promise.all(
      whitelist.map((group) =>
        this.loop.setChannelEnabled(group.group_id, initialSettings[group.group_id] ?? true),
      ),
    );
    this.stopSettingsSubscription = await subscribeConversationSettings(
      this.character.id,
      async () => {
        const settings = await readConversationSettings(this.character.id);
        if (this.stopped) {
          return;
        }
        await Promise.all(
          whitelist.map((group) =>
            this.loop.setChannelEnabled(group.group_id, settings[group.group_id] ?? true),
          ),
        );
      },
    );

    await this.connection.start(async (channelId, message) => {
      // 入口已严格校验白名单；连接建立期间先记录，resume 后再执行模型。
      await this.loop.receive(channelId, message);
    });
    await this.refreshGroupNames();
    await this.stickers.initialize();
    await this.loop.restoreStickerKeys();
    await this.loop.receiveStickerAnnotations(this.stickers.pending());
    if (this.participationAllowed !== undefined) {
      await this.setParticipationAllowed(this.participationAllowed);
    }
    this.loop.resume();
  }

  private async refreshGroupNames(): Promise<void> {
    const whitelist = this.onebot.group_white_list ?? [];
    await Promise.all(
      whitelist.map(async (group) => {
        try {
          const info = await this.connection.api.getGroupInfo(group.group_id);
          this.loop.setChannelName(group.group_id, info.group_name);
        } catch (error) {
          logger.warn("读取 QQ 群名称失败，暂用群号展示", {
            channelId: group.group_id,
            error,
          });
        }
      }),
    );
  }

  async stop() {
    this.stopped = true;
    this.stopSettingsSubscription?.();
    this.connection.stopReceiving();
    // 连接保留到在途轮次结束，分段发送可以按原决定完成。
    const results = await Promise.allSettled([this.loop?.stop(), this.stickers?.stop()]);
    await this.connection.stop();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "群会话停止失败",
      );
    }
  }

  async setParticipationAllowed(allowed: boolean): Promise<void> {
    this.participationAllowed = allowed;
    if (this.loop) {
      await this.loop.setParticipationAllowed(allowed && this.sceneAllowed);
    }
  }

  /** 进入与退出场景只修改自己的限制，不解除睡眠或用户关闭。 */
  async setSceneParticipationAllowed(allowed: boolean): Promise<void> {
    this.sceneAllowed = allowed;
    if (this.loop) {
      await this.loop.setParticipationAllowed(allowed && this.participationAllowed === true);
    }
  }

  /** 主 loop 只提交分享意图，由唯一 Planner 决定是否、在哪个群表达。 */
  async share(event: ConversationAgentEvent): Promise<string> {
    if (!(this.onebot.group_white_list?.length ?? 0)) {
      return "当前没有已连接的 QQ 群，未提交分享。";
    }
    return await this.loop.receiveAgentEvent(event);
  }

  /** 决策反馈附带来源群交给唯一 Planner，群已退出白名单时明确告知未投递。 */
  async receiveAgentEvent(
    scope: ConversationScope,
    event: ConversationAgentEvent,
  ): Promise<string> {
    if (scope.characterId !== this.character.id || scope.platform !== "onebot") {
      throw new Error("事件来源与当前角色的 QQ 会话不匹配");
    }
    if (!this.loop.hasChannel(scope.channelId)) {
      return `未投递：来源 QQ 群 ${scope.channelId} 当前未接入。`;
    }
    return await this.loop.receiveAgentEvent(event, scope.channelId);
  }
}
