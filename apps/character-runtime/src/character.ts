import { createHash, randomUUID } from "node:crypto";
import type { Config } from "@yuiju/shared/config/schema";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type { ActivityView } from "@yuiju/shared/world/protocol";
import { receiveCharacterEvent, trackWorldActivity } from "./agent-loop/events";
import { MainAgentLoop } from "./agent-loop/main";
import { Conversation } from "./conversation/conversation";
import type { ConversationScope } from "./conversation/message";
import { describeEmotion, Emotion } from "./emotion/emotion";
import { DailyMemory } from "./memory/daily";
import { characterKey } from "./storage";
import { WorldClient } from "./world/client";

export type CharacterConfig = NonNullable<Config["characters"]>[string];

export class Character {
  readonly name: string;
  readonly nicknames: readonly string[];
  readonly world: WorldClient;
  private readonly conversation: Conversation | undefined;
  private readonly agent: MainAgentLoop;
  readonly emotion: Emotion;
  private readonly memory: DailyMemory;

  constructor(
    readonly id: string,
    config: CharacterConfig,
  ) {
    this.name = config.name;
    this.emotion = new Emotion(id);
    this.memory = new DailyMemory(id);
    this.nicknames = config.nicknames ?? [];
    this.world = new WorldClient(
      id,
      async () => {
        await receiveCharacterEvent(id, {
          id: randomUUID(),
          type: "connected",
          occurredAt: Date.now(),
        });
        this.agent.wake();
      },
      () => this.agent.wake(),
    );
    if (config.onebot) {
      this.conversation = new Conversation(this, config.onebot);
    }
    this.agent = new MainAgentLoop({
      characterId: id,
      world: this.world,
      emotion: this.emotion,
      share: async (requestId, text) =>
        this.conversation ? await this.conversation.share(requestId, text) : "角色未连接 QQ 群聊。",
      observeActivity: async (activity) => await this.observeActivity(activity),
      syncWorldActivity: async () => await this.syncWorldActivity(),
    });
  }

  async start() {
    await this.memory.initialize();
    await this.emotion.initialize();
    await this.agent.initialize();
    await this.conversation?.start();
    await this.world.start();
    this.agent.start();
    this.emotion.start();
    this.memory.start();
  }

  /** 查询最新活动并同步角色；查询失败保留已知状态，返回说明供主 loop 告知模型。 */
  private async syncWorldActivity(): Promise<string | null> {
    let current: Awaited<ReturnType<WorldClient["inspect"]>>;
    try {
      current = await this.world.inspect({ type: "current" });
    } catch (error) {
      logger.warn("角色同步世界活动失败", { characterId: this.id, error });
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
    await trackWorldActivity(this.id, activity);
    await (await getRedis()).set(
      `${characterKey(this.id)}:observed-activity`,
      JSON.stringify(activity),
    );
    const sleeping = activity?.actionId === "睡觉" || activity?.actionId === "再睡一会";
    await this.conversation?.setParticipationAllowed(!sleeping);
    logger.silly("e2e.character.activity.synced", {
      characterId: this.id,
      activity,
      participationAllowed: !sleeping,
    });
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
    return `${activity ? `最近世界确认正在${activity.actionId}。` : "最近世界确认没有进行中的活动。"}\n${describeEmotion(emotion)}`;
  }

  async notifyFromConversation(
    scope: ConversationScope,
    description: string,
    messageIds: string[],
  ): Promise<string> {
    const id = createHash("sha256")
      .update(JSON.stringify([scope, [...messageIds].sort(), description]))
      .digest("hex");
    await receiveCharacterEvent(this.id, {
      id: `conversation:${id}`,
      occurredAt: Date.now(),
      type: "conversation",
      scope,
      description,
      messageIds,
    });
    this.agent.wake();
    return "已告知角色当前决策流程；是否采纳或形成安排，仍由角色自己决定。";
  }

  async stop() {
    await this.agent.stop();
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
