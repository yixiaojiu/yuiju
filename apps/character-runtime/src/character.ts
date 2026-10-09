import { createHash, randomUUID } from "node:crypto";
import type { Config } from "@yuiju/shared/config/schema";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type { ActivityView } from "@yuiju/shared/world/protocol";
import { receiveCharacterEvent, trackWorldActivity } from "./agent-loop/events";
import { MainAgentLoop } from "./agent-loop/main";
import { readCommunicationSource, saveCommunicationSource } from "./communication";
import { Conversation } from "./conversation/conversation";
import type { ConversationScope } from "./conversation/message";
import { describeEmotion, Emotion } from "./emotion/emotion";
import { DailyMemory } from "./memory/daily";
import { characterKey } from "./storage";
import { WorldClient } from "./world/client";

export type CharacterConfig = NonNullable<Config["characters"]>[string];
/** 单独调试时只启动对应 loop；all 保留完整角色生命周期。 */
export type CharacterMode = "all" | "conversation" | "agent";

export class Character {
  readonly name: string;
  readonly nicknames: readonly string[];
  readonly world: WorldClient;
  private readonly conversation: Conversation | undefined;
  private readonly agent: MainAgentLoop | undefined;
  readonly emotion: Emotion;
  private readonly memory: DailyMemory;

  constructor(
    readonly id: string,
    config: CharacterConfig,
    private readonly mode: CharacterMode,
  ) {
    this.name = config.name;
    this.emotion = new Emotion(id);
    this.memory = new DailyMemory(id);
    this.nicknames = config.nicknames ?? [];
    this.world = new WorldClient(
      id,
      async (current) => {
        if (!this.agent) {
          await this.observeActivity(current.activity);
          return;
        }
        await receiveCharacterEvent(id, {
          id: randomUUID(),
          type: "connected",
          occurredAt: Date.now(),
        });
        this.agent.wake();
      },
      async () => {
        if (this.agent) {
          this.agent.wake();
        } else {
          // 重发的通知可能属于旧活动，始终查询世界当前状态。
          const error = await this.syncWorldActivity();
          if (error !== null) {
            throw new Error(error);
          }
        }
      },
      { queueAgentEvents: mode !== "conversation" },
    );
    if (mode !== "agent" && config.onebot) {
      this.conversation = new Conversation(this, config.onebot);
    }
    if (mode === "conversation") {
      return;
    }
    this.agent = new MainAgentLoop({
      characterId: id,
      world: this.world,
      emotion: this.emotion,
      share: async (requestId, text, occurredAt) => {
        if (mode === "agent") {
          return "调试模式未启用聊天，未投递。";
        }
        if (!this.conversation) {
          return "角色未连接 QQ 群聊，未投递。";
        }
        await saveCommunicationSource(id, requestId, { type: "main" }, occurredAt);
        return await this.conversation.share({
          id: requestId,
          type: "share",
          content: text,
          occurredAt,
        });
      },
      respondConversation: async (requestId, eventId, content, occurredAt) => {
        if (mode === "agent") {
          return "调试模式未启用聊天，未投递。";
        }
        const source = await readCommunicationSource(id, eventId);
        if (source?.type !== "conversation") {
          return "未投递：eventId 不是有效的群聊事件或关联已过期，请使用收到的群聊事件 ID。";
        }
        if (!this.conversation) {
          return "角色未连接 QQ 群聊，未投递。";
        }
        await saveCommunicationSource(id, requestId, { type: "main" }, occurredAt);
        return await this.conversation.receiveAgentEvent(source.scope, {
          id: requestId,
          type: "result",
          content,
          occurredAt,
          relatedEventId: eventId,
        });
      },
      observeActivity: async (activity) => await this.observeActivity(activity),
      syncWorldActivity: async () => await this.syncWorldActivity(),
    });
  }

  async start() {
    await this.memory.initialize();
    await this.emotion.initialize();
    await this.agent?.initialize();
    // 聊天独立运行时，先确认活动和睡眠权限，再恢复群会话。
    if (this.mode === "conversation") {
      const current = await this.world.inspect({ type: "current" });
      if (!current.ok) {
        throw new Error(current.message);
      }
      if (current.value.type !== "current") {
        throw new Error("世界 current 查询返回了其他类型");
      }
      await this.observeActivity(current.value.activity);
      const sleeping =
        current.value.activity?.actionId === "睡觉" ||
        current.value.activity?.actionId === "再睡一会";
      await this.conversation?.start(!sleeping);
    } else {
      await this.conversation?.start();
    }
    await this.world.start();
    this.agent?.start();
    if (this.agent) {
      this.emotion.start();
    }
    if (this.mode === "all") {
      this.memory.start();
    }
  }

  /** 查询最新活动并同步角色；查询失败保留已知状态，返回说明供主 loop 告知模型。 */
  private async syncWorldActivity(): Promise<string | null> {
    let current: Awaited<ReturnType<WorldClient["inspect"]>>;
    try {
      current = await this.world.inspect({ type: "current" });
    } catch (error) {
      logger.warn("角色同步世界活动失败", { error });
      return "当前世界暂时无法查询，活动是否结束尚未确认，不要将到点当作完成。";
    }
    if (!current.ok) {
      return `当前世界活动未确认：${current.message}`;
    }
    if (current.value.type === "current") {
      await this.observeActivity(current.value.activity);
    }
    return null;
  }

  /** 统一同步活动等待、感知与聊天权限；不能靠本地倒计时提前解除睡眠。 */
  private async observeActivity(activity: ActivityView | null): Promise<void> {
    if (this.agent) {
      await trackWorldActivity(this.id, activity);
    }
    await (await getRedis()).set(
      `${characterKey(this.id)}:observed-activity`,
      JSON.stringify(activity),
    );
    const sleeping = activity?.actionId === "睡觉" || activity?.actionId === "再睡一会";
    await this.conversation?.setParticipationAllowed(!sleeping);
  }

  /** 群聊只获得可表达的状态；情绪原因和主 loop 的完整上下文不自动跨群带入。 */
  async readConversationContext(): Promise<string> {
    const [stored, emotion] = await Promise.all([
      (await getRedis()).get(`${characterKey(this.id)}:observed-activity`),
      this.emotion.read(),
    ]);
    if (stored === null) {
      throw new Error("角色尚未确认世界活动状态");
    }
    const activity: ActivityView | null = JSON.parse(stored);
    const description =
      activity?.actionId === "空闲发呆"
        ? "最近世界确认正在发呆，暂时没有安排。"
        : activity
          ? `最近世界确认正在${activity.actionId}。`
          : "最近世界确认没有进行中的活动。";
    return `${description}\n${describeEmotion(emotion)}`;
  }

  async notifyFromConversation(
    scope: ConversationScope,
    description: string,
    messageIds: string[],
    relatedEventId?: string,
  ): Promise<string> {
    if (!this.agent) {
      return "调试模式未启用主 agent，未投递。";
    }
    if (relatedEventId) {
      const source = await readCommunicationSource(this.id, relatedEventId);
      if (source?.type !== "main") {
        return "未投递：关联事件不存在、不是主 loop 事件或已超过 30 天。";
      }
    }
    const id = createHash("sha256")
      .update(JSON.stringify([scope, [...messageIds].sort(), description, relatedEventId]))
      .digest("hex");
    const eventId = `conversation:${id}`;
    const occurredAt = Date.now();
    await saveCommunicationSource(this.id, eventId, { type: "conversation", scope }, occurredAt);
    await receiveCharacterEvent(this.id, {
      id: eventId,
      occurredAt,
      type: "conversation",
      scope,
      description,
      messageIds,
      relatedEventId,
    });
    this.agent.wake();
    return `已投递给主 loop，事件 ID：${eventId}。尚不代表已作出决定。`;
  }

  async stop() {
    await this.agent?.stop();
    const results = await Promise.allSettled([
      this.conversation?.stop(),
      this.world.stop(),
      this.emotion.stop(),
      this.memory.stop(),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "角色模块停止失败",
      );
    }
  }
}
