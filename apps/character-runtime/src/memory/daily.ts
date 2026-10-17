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

/** 每日整理只持久化素材截止时间，摘要和草稿留在内存，失败不自动补录。 */
export class DailyMemory {
  private readonly stopping = new AbortController();
  private archiveTask: Promise<void> | undefined;
  private dailyTask: Promise<void> | undefined;

  constructor(private readonly characterId: string) {}

  async initialize(): Promise<void> {
    await initializeSelfCognition(this.characterId);
    await initializePeople(this.characterId);
    // 新角色从现存素材开始；旧数据迁移需单独设置节点，不在运行时转换旧任务。
    await (await getRedis()).setnx(`${characterKey(this.characterId)}:memory:through`, "0");
  }

  start(): void {
    this.archiveTask = this.runArchive();
    this.dailyTask = this.runDaily();
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

  private async runDaily(): Promise<void> {
    const timezone = (await load_config()).app!.timezone!;
    while (!this.stopping.signal.aborted) {
      const date = dayjs().tz(timezone).format("YYYY-MM-DD");
      // 计划清理独立于素材读取和模型生成；已通知但未处理的计划到期即可移除。
      try {
        const removed = await cleanupPlans(this.characterId, Date.now());
        if (removed) {
          logger.info("已清理无人处理或过期的计划", { count: removed });
        }
      } catch (error) {
        if (this.stopping.signal.aborted) {
          return;
        }
        logger.error("每日计划清理失败，本次跳过", { error });
      }
      try {
        await this.organizeThrough(dayjs.tz(date, timezone).valueOf(), timezone);
      } catch (error) {
        if (this.stopping.signal.aborted) {
          return;
        }
        logger.error("每日记忆素材读取或时间节点保存失败，本次未开始生成", { error });
      }
      // 处理积压可能跨过零点；下一轮补齐新的区间，不跳过已到达的整理日。
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

  /** 查询成功后先推进节点，再执行模型调用；即使停机，已尝试区间也不会重新生成。 */
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
    await redis.set(key, String(through));

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
    await Promise.all([this.archiveTask, this.dailyTask]);
  }
}
