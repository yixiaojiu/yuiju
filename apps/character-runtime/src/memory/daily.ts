import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { renderMessage } from "../conversation/message";
import {
  type ArchivedConversationMessage,
  type MemoryMessageReference,
  markMessagesOrganized,
  queryUnorganizedMessages,
  readMemoryMessages,
} from "../conversation/storage";
import { forgetEndedPlans } from "../plan/plan";
import { characterKey } from "../storage";
import {
  archiveExperiences,
  type ConversationMemorySummary,
  coarsenExperiences,
  type ExperienceMaterial,
  type ExperienceMemory,
  materialCollection,
  memoryCollection,
  memoryPeriodId,
  prepareExperienceMemory,
  saveExperienceMemory,
  summarizeMemoryConversation,
} from "./experiences";
import { writeMemoryFile } from "./files";
import { forgetPeople, initializePeople, organizePeople, pruneInactivePeople } from "./people";
import { updatePeopleActivity } from "./people-activity";
import { prepareReviewedSelfCognition } from "./review";
import {
  initializeSelfCognition,
  readSelfCognition,
  type SelfCognition,
  selfCognitionPath,
} from "./self-cognition";
import { indexExperienceMemory } from "./vector-index";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** 固定来源及定位信息；Mongo 原始消息与经历材料各自只保存一份正文。 */
type DailyMemorySource =
  | { type: "material"; id: string }
  | ({ type: "message" } & MemoryMessageReference);

/** 聊天在整理时才转成输入材料，原文不复制到素材表。 */
function conversationMaterial(
  message: ArchivedConversationMessage,
  timezone: string,
): ExperienceMaterial {
  return {
    id: `conversation:${message.platform}:${message.channelId}:${message.sequence}`,
    occurredAt: message.timestamp,
    source: "conversation",
    content: renderMessage(message, timezone),
    conversation: { platform: message.platform, channelId: message.channelId },
    people: message.isSelf
      ? []
      : [{ platform: message.platform, userId: message.senderId, name: message.senderName }],
  };
}

/** 生成经历正文，再生成并审查认知；两份草稿完成后提交正文、索引和认知。 */
export type DailyMemoryJob = {
  date: string;
  days: { date: string; batches: DailyMemorySource[][] }[];
  dayIndex: number;
  batchIndex: number;
  stage: "activity" | "conversations" | "experiences" | "commit" | "people" | "release";
  /** 当前批次已成功整理的群聊素材，顺序与该批群聊分组一致；正文合入后清空。 */
  conversationSummaries: ConversationMemorySummary[];
  draft: { experience: ExperienceMemory; cognition: SelfCognition } | null;
};

/** 角色记忆自己的后台生命周期；归档每五秒检查，三类长期记忆仅每日整理一次。 */
export class DailyMemory {
  private readonly stopping = new AbortController();
  private archiveTask: Promise<void> | undefined;
  private dailyTask: Promise<void> | undefined;

  constructor(private readonly characterId: string) {}

  async initialize(): Promise<void> {
    await initializeSelfCognition(this.characterId);
    await initializePeople(this.characterId);
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
        logger.error("角色经历归档失败，保留 Redis 材料", { characterId: this.characterId, error });
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
    const config = await load_config();
    const timezone = config.app!.timezone!;
    // 同一批原文用于群聊压缩与人物画像，必须同时适配 flash 和 strong。
    const windowTokens = Math.min(
      config.llm!.models!.strong!.context_window_tokens!,
      config.llm!.models!.flash!.context_window_tokens!,
    );
    while (!this.stopping.signal.aborted) {
      let nextAt: number;
      try {
        const date = dayjs().tz(timezone).format("YYYY-MM-DD");
        const due = dayjs.tz(date, timezone);
        const redis = await getRedis();
        const key = `${characterKey(this.characterId)}:memory:daily`;
        const stored = await redis.get(key);
        let job: DailyMemoryJob | null = stored === null ? null : JSON.parse(stored);
        const completed = await redis.get(`${key}:completed`);
        if (!job && completed !== date) {
          // 先将已有素材归档，再固定本轮范围；零点本身属于新一天，不提前整理。
          await archiveExperiences(this.characterId);
          const materials = await (await materialCollection())
            .find({
              characterId: this.characterId,
              organized: { $ne: true },
              occurredAt: { $lt: due.valueOf() },
            })
            .sort({ occurredAt: 1, id: 1 })
            .toArray();
          const messages = await queryUnorganizedMessages(this.characterId, due.valueOf());
          const inputs: { material: ExperienceMaterial; reference: DailyMemorySource }[] = [
            ...materials.map((material) => ({
              material,
              reference: { type: "material" as const, id: material.id },
            })),
            ...messages.map((message) => ({
              material: conversationMaterial(message, timezone),
              reference: {
                type: "message" as const,
                platform: message.platform,
                channelId: message.channelId,
                sequence: message.sequence,
              },
            })),
          ];
          inputs.sort(
            (a, b) =>
              a.material.occurredAt - b.material.occurredAt ||
              a.material.id.localeCompare(b.material.id),
          );
          const groups = new Map<string, typeof inputs>();
          for (const input of inputs) {
            const date = dayjs(input.material.occurredAt).tz(timezone).format("YYYY-MM-DD");
            const group = groups.get(date) ?? [];
            group.push(input);
            groups.set(date, group);
          }
          const days: DailyMemoryJob["days"] = [];
          for (const [date, group] of groups) {
            const batches: DailyMemorySource[][] = [[]];
            let size = 0;
            for (const { material, reference } of group) {
              const bytes = Buffer.byteLength(JSON.stringify(material), "utf8");
              if (bytes >= windowTokens * 0.5) {
                throw new Error(`单条经历材料超过整理输入预算：${material.id}`);
              }
              if (size + bytes >= windowTokens * 0.5) {
                batches.push([]);
                size = 0;
              }
              batches.at(-1)!.push(reference);
              size += bytes;
            }
            days.push({ date, batches });
          }
          job = {
            date,
            days,
            dayIndex: 0,
            batchIndex: 0,
            stage: "activity",
            conversationSummaries: [],
            draft: null,
          };
          await redis.set(key, JSON.stringify(job));
        }
        if (job) {
          await this.organize(job, key);
        }
        // 恢复的是旧任务时立即补当前日期；下一次零点重新按时区解析，避免夏令时偏移。
        nextAt =
          job && job.date !== date
            ? Date.now()
            : dayjs.tz(dayjs.utc(date).add(1, "day").format("YYYY-MM-DD"), timezone).valueOf();
      } catch (error) {
        if (this.stopping.signal.aborted) {
          return;
        }
        logger.error("每日记忆整理中断，保留分阶段进度", { characterId: this.characterId, error });
        nextAt = Date.now() + 60_000;
      }
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

  private async organize(job: DailyMemoryJob, key: string): Promise<void> {
    const redis = await getRedis();
    const collection = await materialCollection();
    const timezone = (await load_config()).app!.timezone!;
    if (job.stage === "activity") {
      // 按已冻结的整日范围统计一次；模型失败不能重复累计，也不能阻止不活跃清理。
      const messages: ArchivedConversationMessage[] = [];
      for (const day of job.days) {
        for (const batch of day.batches) {
          const references = batch
            .filter((source) => source.type === "message")
            .map(({ type, ...reference }) => reference);
          const stored = await readMemoryMessages(this.characterId, references);
          if (stored.length !== references.length) {
            throw new Error("活跃统计的原始消息缺失，不能跳过已固定的范围");
          }
          messages.push(...stored);
        }
      }
      await updatePeopleActivity(this.characterId, job.date, messages);
      await pruneInactivePeople(this.characterId);
      job.stage = "conversations";
      await redis.set(key, JSON.stringify(job));
    }
    while (job.dayIndex < job.days.length) {
      this.stopping.signal.throwIfAborted();
      const day = job.days[job.dayIndex];
      if (job.stage === "commit") {
        // 三处持久化不是同一事务；草稿已保存在 Redis，中断后重放写入，不重新生成。
        await saveExperienceMemory(job.draft!.experience);
        await indexExperienceMemory(job.draft!.experience, this.stopping.signal);
        await writeMemoryFile(await selfCognitionPath(this.characterId), job.draft!.cognition);
        job.batchIndex = 0;
        job.stage = "people";
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      if (job.stage === "release") {
        // 两种来源都确认后才推进日期；中途失败可按原批次重复确认。
        for (const batch of day.batches) {
          const materialIds = batch
            .filter((source) => source.type === "material")
            .map((source) => source.id);
          await collection.updateMany({ characterId: this.characterId, id: { $in: materialIds } }, [
            {
              $set: {
                organized: true,
                expiresAt: { $toDate: { $add: ["$occurredAt", 30 * 86_400_000] } },
              },
            },
          ]);
          await markMessagesOrganized(
            this.characterId,
            batch
              .filter((source) => source.type === "message")
              .map(({ type, ...reference }) => reference),
          );
        }
        job.dayIndex += 1;
        job.batchIndex = 0;
        job.stage = "conversations";
        job.draft = null;
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      const sources = day.batches[job.batchIndex];
      const materialIds = sources
        .filter((source) => source.type === "material")
        .map((source) => source.id);
      const materials: ExperienceMaterial[] = await collection
        .find({ characterId: this.characterId, id: { $in: materialIds } })
        .toArray();
      const messages = await readMemoryMessages(
        this.characterId,
        sources
          .filter((source) => source.type === "message")
          .map(({ type, ...reference }) => reference),
      );
      materials.push(...messages.map((message) => conversationMaterial(message, timezone)));
      materials.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
      if (materials.length !== sources.length) {
        throw new Error("每日整理的来源材料缺失，不能跳过已固定的依据");
      }
      if (job.stage === "conversations") {
        // 只在群内压缩；一群成功即保存，重启后从未完成的群继续。
        const groups = new Map<string, ExperienceMaterial[]>();
        for (const material of materials) {
          if (material.source !== "conversation") {
            continue;
          }
          const { platform, channelId } = material.conversation!;
          const groupKey = JSON.stringify([platform, channelId]);
          const group = groups.get(groupKey) ?? [];
          group.push(material);
          groups.set(groupKey, group);
        }
        for (const group of [...groups.values()].slice(job.conversationSummaries.length)) {
          const summary = await summarizeMemoryConversation(
            this.characterId,
            day.date,
            group,
            this.stopping.signal,
          );
          job.conversationSummaries.push(summary);
          await redis.set(key, JSON.stringify(job));
        }
        job.stage = "experiences";
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      const batchId = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
      if (job.stage === "experiences") {
        const previous =
          job.draft?.experience ??
          (await (
            await memoryCollection()
          ).findOne({
            characterId: this.characterId,
            id: memoryPeriodId("day", day.date),
          }));
        const experience = await prepareExperienceMemory(
          this.characterId,
          day.date,
          materials.filter((material) => material.source !== "conversation"),
          job.conversationSummaries,
          previous?.text ?? "",
          this.stopping.signal,
        );
        const cognition = await prepareReviewedSelfCognition(
          this.characterId,
          batchId,
          job.draft?.cognition ?? (await readSelfCognition(this.characterId)),
          experience,
          this.stopping.signal,
        );
        job.draft = { experience, cognition };
        job.batchIndex += 1;
        job.conversationSummaries = [];
        job.stage = job.batchIndex === day.batches.length ? "commit" : "conversations";
      } else {
        await organizePeople(this.characterId, batchId, materials, this.stopping.signal);
        job.batchIndex += 1;
        job.stage = job.batchIndex === day.batches.length ? "release" : "people";
      }
      await redis.set(key, JSON.stringify(job));
    }
    await coarsenExperiences(this.characterId, job.date, this.stopping.signal);
    await forgetPeople(this.characterId, job.date, this.stopping.signal);
    await forgetEndedPlans(this.characterId, Date.now() - 30 * 86_400_000);
    // 同事务保存完成日期并移除任务；故障恢复不能遗漏某天，也不重新整理已确认批次。
    const results = await redis
      .multi()
      .set(`${key}:completed`, job.date)
      .del(key, `${key}:people`)
      .exec();
    if (results === null) {
      throw new Error("每日记忆完成状态未提交");
    }
    for (const [error] of results) {
      if (error) {
        throw error;
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping.abort();
    await Promise.all([this.archiveTask, this.dailyTask]);
  }
}
