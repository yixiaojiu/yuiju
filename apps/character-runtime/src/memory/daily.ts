import { setTimeout } from "node:timers/promises";
import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { renderMessage } from "../conversation/message";
import { queryMemoryMessages } from "../conversation/storage";
import { cleanupPlans } from "../plan/plan";
import { characterKey } from "../storage";
import {
  archiveExperiences,
  type ConversationMemorySummary,
  coarsenExperiences,
  type ExperienceMaterial,
  materialCollection,
  memoryCollection,
  memoryPeriodId,
  prepareExperienceMemory,
  saveExperienceMemory,
  summarizeMemoryConversation,
} from "./experiences";
import { writeMemoryFile } from "./files";
import { forgetPeople, initializePeople, pruneInactivePeople } from "./people";
import { updatePeopleActivity } from "./people-activity";
import { prepareReviewedSelfCognition } from "./review";
import { initializeSelfCognition, readSelfCognition, selfCognitionPath } from "./self-cognition";
import { generateMemoryChunks, indexExperienceMemory } from "./vector-index";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** 入睡后整理记忆，只持久化素材截止时间；原始归档和每日计划清理独立运行。 */
export class DailyMemory {
  private readonly stopping = new AbortController();
  private archiveTask: Promise<void> | undefined;
  private planCleanupTask: Promise<void> | undefined;
  private organizeTask: Promise<void> | undefined;
  /** 合并重复的活动观察；即使领取节点失败，本进程也不重复尝试同一次入睡。 */
  private latestSleepAt = 0;

  constructor(private readonly characterId: string) {}

  async initialize(): Promise<void> {
    await initializeSelfCognition(this.characterId);
    await initializePeople(this.characterId);
    // 新角色从现存素材开始；旧数据迁移需单独设置节点，不在运行时转换旧任务。
    await (await getRedis()).setnx(`${characterKey(this.characterId)}:memory:through`, "0");
  }

  start(): void {
    this.archiveTask = this.runArchive();
    this.planCleanupTask = this.runPlanCleanup();
  }

  /** 由角色确认睡眠后调用；串行整理不同入睡区间，不阻塞世界通知和角色调度。 */
  organizeAfterSleep(startedAt: number): void {
    if (this.stopping.signal.aborted || startedAt <= this.latestSleepAt) {
      return;
    }
    this.latestSleepAt = startedAt;
    this.organizeTask = this.runSleepOrganization(startedAt, this.organizeTask);
  }

  private async runSleepOrganization(through: number, previous?: Promise<void>): Promise<void> {
    try {
      await previous;
      this.stopping.signal.throwIfAborted();
      const timezone = (await load_config()).app!.timezone!;
      await this.organizeThrough(through, timezone);
    } catch (error) {
      if (!this.stopping.signal.aborted) {
        logger.error("睡后记忆整理失败，本次跳过且不再自动重试", { error });
      }
    }
  }

  private async runArchive(): Promise<void> {
    while (!this.stopping.signal.aborted) {
      try {
        await archiveExperiences(this.characterId);
      } catch (error) {
        logger.error("读取或移除待归档经历失败，本轮停止扫描", { error });
      }
      try {
        await setTimeout(5_000, undefined, { signal: this.stopping.signal });
      } catch (error) {
        if (!this.stopping.signal.aborted) {
          throw error;
        }
      }
    }
  }

  private async runPlanCleanup(): Promise<void> {
    const timezone = (await load_config()).app!.timezone!;
    while (!this.stopping.signal.aborted) {
      const date = dayjs().tz(timezone).format("YYYY-MM-DD");
      // 计划清理独立于素材读取和模型生成；已通知但未处理的计划到期即可移除。
      try {
        const removed = await cleanupPlans(this.characterId, Date.now());
        if (removed) {
          logger.info("已清理结束或提醒后未处理的计划", { count: removed });
        }
      } catch (error) {
        if (this.stopping.signal.aborted) {
          return;
        }
        logger.error("每日计划清理失败，本次跳过", { error });
      }
      // 清理仍在启动及每天零点执行，不依赖角色是否入睡。
      const nextAt = dayjs
        .tz(dayjs.utc(date).add(1, "day").format("YYYY-MM-DD"), timezone)
        .valueOf();
      try {
        await setTimeout(Math.max(0, nextAt - Date.now()), undefined, {
          signal: this.stopping.signal,
        });
      } catch (error) {
        if (!this.stopping.signal.aborted) {
          throw error;
        }
      }
    }
  }

  /** 先领取区间并推进节点，再读取素材和生成；失败或停机均不重试已领取区间。 */
  private async organizeThrough(through: number, timezone: string): Promise<void> {
    const redis = await getRedis();
    const key = `${characterKey(this.characterId)}:memory:through`;
    const from = z
      .number()
      .int()
      .nonnegative()
      .parse(JSON.parse((await redis.get(key))!));
    if (from >= through) {
      return;
    }
    this.stopping.signal.throwIfAborted();
    await redis.set(key, String(through));
    logger.info("开始睡后记忆整理", { from, through });
    await archiveExperiences(this.characterId);
    const materials: ExperienceMaterial[] = await (await materialCollection())
      .find({
        characterId: this.characterId,
        occurredAt: { $gte: from, $lt: through },
      })
      .sort({ occurredAt: 1, id: 1 })
      .toArray();
    const messages = await queryMemoryMessages(this.characterId, from, through);
    this.stopping.signal.throwIfAborted();

    const date = dayjs(through).tz(timezone).format("YYYY-MM-DD");
    try {
      await updatePeopleActivity(this.characterId, date, messages);
      await pruneInactivePeople(this.characterId);
    } catch (error) {
      this.stopping.signal.throwIfAborted();
      logger.warn("人物活跃统计或清理失败，本次跳过", { error });
    }
    const config = await load_config();
    const botIds = config.characters![this.characterId].onebot?.bot_ids ?? [];
    materials.push(
      ...messages.map((message) => ({
        id: `conversation:${message.platform}:${message.channelId}:${message.sequence}`,
        occurredAt: message.timestamp,
        source: "conversation" as const,
        content: renderMessage(message, timezone, botIds),
        conversation: { platform: message.platform, channelId: message.channelId },
        people: [],
      })),
    );
    materials.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
    const days = new Map<string, ExperienceMaterial[]>();
    for (const material of materials) {
      const day = dayjs(material.occurredAt).tz(timezone).format("YYYY-MM-DD");
      const group = days.get(day) ?? [];
      group.push(material);
      days.set(day, group);
    }
    for (const [day, inputs] of days) {
      this.stopping.signal.throwIfAborted();
      try {
        await this.organizeDay(day, inputs, `${from}:${through}:${day}`);
      } catch (error) {
        this.stopping.signal.throwIfAborted();
        logger.error("当日记忆整理失败，跳过且不再自动重试", { date: day, error });
      }
    }
    try {
      await coarsenExperiences(this.characterId, date, this.stopping.signal);
    } catch (error) {
      this.stopping.signal.throwIfAborted();
      logger.warn("记忆归并未完成，本次跳过", { error });
    }
    try {
      await forgetPeople(this.characterId, this.stopping.signal);
    } catch (error) {
      this.stopping.signal.throwIfAborted();
      logger.warn("人物画像清理未完成，本次跳过", { error });
    }
  }

  /** 聊天先分批概括；当天经历及自我认知各生成一次，不随聊天批次反复重写。 */
  private async organizeDay(
    date: string,
    materials: ExperienceMaterial[],
    batchId: string,
  ): Promise<void> {
    const conversations = await this.summarizeConversations(date, materials);
    const previous = await (await memoryCollection()).findOne({
      characterId: this.characterId,
      id: memoryPeriodId("day", date),
    });
    const experience = await prepareExperienceMemory(
      this.characterId,
      date,
      materials.filter((material) => material.source !== "conversation"),
      conversations,
      previous?.text ?? "",
      this.stopping.signal,
    );
    const cognition = await prepareReviewedSelfCognition(
      this.characterId,
      batchId,
      await readSelfCognition(this.characterId),
      experience,
      this.stopping.signal,
    );
    await saveExperienceMemory(experience);
    await writeMemoryFile(await selfCognitionPath(this.characterId), cognition);
    const chunks = await generateMemoryChunks(experience, this.stopping.signal);
    await indexExperienceMemory(experience, chunks, this.stopping.signal);
  }

  private async summarizeConversations(
    date: string,
    materials: ExperienceMaterial[],
  ): Promise<ConversationMemorySummary[]> {
    const budget = (await load_config()).llm!.models!.flash!.context_window_tokens! * 0.5;
    const groups = new Map<string, ExperienceMaterial[]>();
    for (const material of materials) {
      if (material.source !== "conversation") {
        continue;
      }
      const key = JSON.stringify(material.conversation);
      const group = groups.get(key) ?? [];
      group.push(material);
      groups.set(key, group);
    }
    const summaries: ConversationMemorySummary[] = [];
    for (const group of groups.values()) {
      const batches: ExperienceMaterial[][] = [[]];
      let size = 0;
      for (const material of group) {
        const bytes = Buffer.byteLength(material.content, "utf8");
        if (
          batches.at(-1)!.length > 0 &&
          (batches.at(-1)!.length >= 100 || size + bytes >= budget)
        ) {
          batches.push([]);
          size = 0;
        }
        batches.at(-1)!.push(material);
        size += bytes;
      }
      for (const [index, batch] of batches.entries()) {
        this.stopping.signal.throwIfAborted();
        try {
          summaries.push(
            await summarizeMemoryConversation(this.characterId, date, batch, this.stopping.signal),
          );
        } catch (error) {
          this.stopping.signal.throwIfAborted();
          logger.error("群聊摘要失败，跳过该批且不再自动重试", {
            date,
            channel: batch[0].conversation!.channelId,
            batch: index + 1,
            messages: batch.length,
            error,
          });
        }
      }
    }
    return summaries;
  }

  async stop(): Promise<void> {
    this.stopping.abort();
    await Promise.all([this.archiveTask, this.planCleanupTask, this.organizeTask]);
  }
}
