import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { forgetEndedPlans } from "../plan/plan";
import { characterKey } from "../storage";
import {
  archiveExperiences,
  coarsenExperiences,
  type ExperienceMemory,
  materialCollection,
  memoryCollection,
  memoryPeriodId,
  prepareExperienceMemory,
  saveExperienceMemory,
} from "./experiences";
import { forgetPeople, initializePeople, organizePeople } from "./people";
import { initializeSelfCognition, organizeSelfCognition } from "./self-cognition";
import { indexExperienceMemory } from "./vector-index";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** 先完成同一天的正文，再处理索引及其他记忆；每次提交后才推进阶段。 */
export type DailyMemoryJob = {
  date: string;
  days: { date: string; batches: string[][] }[];
  dayIndex: number;
  batchIndex: number;
  stage: "experiences" | "index" | "cognition" | "people" | "release";
  draft: ExperienceMemory | null;
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
    const windowTokens = config.llm!.models!.strong!.context_window_tokens!;
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
          const groups = new Map<string, typeof materials>();
          for (const material of materials) {
            const date = dayjs(material.occurredAt).tz(timezone).format("YYYY-MM-DD");
            const group = groups.get(date) ?? [];
            group.push(material);
            groups.set(date, group);
          }
          const days: DailyMemoryJob["days"] = [];
          for (const [date, group] of groups) {
            const batches: string[][] = [[]];
            let size = 0;
            for (const material of group) {
              const bytes = Buffer.byteLength(JSON.stringify(material), "utf8");
              if (bytes >= windowTokens * 0.5) {
                throw new Error(`单条经历材料超过整理输入预算：${material.id}`);
              }
              if (size + bytes >= windowTokens * 0.5) {
                batches.push([]);
                size = 0;
              }
              batches.at(-1)!.push(material.id);
              size += bytes;
            }
            days.push({ date, batches });
          }
          job = { date, days, dayIndex: 0, batchIndex: 0, stage: "experiences", draft: null };
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
    while (job.dayIndex < job.days.length) {
      this.stopping.signal.throwIfAborted();
      const day = job.days[job.dayIndex];
      if (job.stage === "index") {
        await saveExperienceMemory(job.draft!);
        await indexExperienceMemory(job.draft!, this.stopping.signal);
        job.batchIndex = 0;
        job.stage = "cognition";
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      if (job.stage === "release") {
        await collection.updateMany(
          { characterId: this.characterId, id: { $in: day.batches.flat() } },
          [
            {
              $set: {
                organized: true,
                expiresAt: { $toDate: { $add: ["$occurredAt", 30 * 86_400_000] } },
              },
            },
          ],
        );
        job.dayIndex += 1;
        job.batchIndex = 0;
        job.stage = "experiences";
        job.draft = null;
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      const ids = day.batches[job.batchIndex];
      const materials = await collection
        .find({ characterId: this.characterId, id: { $in: ids } })
        .sort({ occurredAt: 1, id: 1 })
        .toArray();
      if (materials.length !== ids.length) {
        throw new Error("每日整理的来源材料缺失，不能跳过已固定的依据");
      }
      const batchId = createHash("sha256").update(ids.join("\n")).digest("hex");
      if (job.stage === "experiences") {
        const previous =
          job.draft ??
          (await (
            await memoryCollection()
          ).findOne({
            characterId: this.characterId,
            id: memoryPeriodId("day", day.date),
          }));
        job.draft = await prepareExperienceMemory(
          this.characterId,
          day.date,
          materials,
          previous?.text ?? "",
          this.stopping.signal,
        );
        job.batchIndex += 1;
        if (job.batchIndex === day.batches.length) {
          job.stage = "index";
        }
      } else if (job.stage === "cognition") {
        await organizeSelfCognition(this.characterId, batchId, materials, this.stopping.signal);
        job.stage = "people";
      } else {
        await organizePeople(this.characterId, batchId, materials, this.stopping.signal);
        job.batchIndex += 1;
        job.stage = job.batchIndex === day.batches.length ? "release" : "cognition";
      }
      await redis.set(key, JSON.stringify(job));
    }
    await coarsenExperiences(this.characterId, job.date, this.stopping.signal);
    await forgetPeople(this.characterId);
    await forgetEndedPlans(this.characterId, Date.now() - 30 * 86_400_000);
    // 同事务保存完成日期并移除任务；故障恢复不能遗漏某天，也不重新整理已确认批次。
    const results = await redis.multi().set(`${key}:completed`, job.date).del(key).exec();
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
