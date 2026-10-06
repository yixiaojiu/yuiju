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
  prepareExperienceMemories,
  saveExperienceMemories,
} from "./experiences";
import { forgetPeople, initializePeople, organizePeople } from "./people";
import { initializeSelfCognition, organizeSelfCognition } from "./self-cognition";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** 固定原材料边界与分阶段进度；新的材料不会混入已开始的每日整理。 */
type DailyMemoryJob = {
  date: string;
  cutoff: number;
  batches: string[][];
  index: number;
  stage: "experiences" | "cognition" | "people" | "release";
  prepared: ExperienceMemory[] | null;
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
        const localNow = dayjs().tz(timezone);
        let due = dayjs.tz(`${localNow.format("YYYY-MM-DD")} 04:00`, timezone);
        if (due.valueOf() > Date.now()) {
          due = dayjs.tz(`${localNow.subtract(1, "day").format("YYYY-MM-DD")} 04:00`, timezone);
        }
        const redis = await getRedis();
        const key = `${characterKey(this.characterId)}:memory:daily`;
        const stored = await redis.get(key);
        let job: DailyMemoryJob | null = stored === null ? null : JSON.parse(stored);
        const completed = await redis.get(`${key}:completed`);
        if (!job && completed !== due.format("YYYY-MM-DD")) {
          const materials = await (await materialCollection())
            .find({
              characterId: this.characterId,
              organized: { $ne: true },
              occurredAt: { $lte: due.valueOf() },
            })
            .sort({ occurredAt: 1, id: 1 })
            .toArray();
          const groups = new Map<string, string[][]>();
          const sizes = new Map<string, number>();
          for (const material of materials) {
            const groupKey = JSON.stringify([
              dayjs(material.occurredAt).tz(timezone).format("YYYY-MM-DD"),
              material.conversation ?? null,
              material.source === "feeling",
            ]);
            const batches = groups.get(groupKey) ?? [[]];
            const size = Buffer.byteLength(JSON.stringify(material), "utf8");
            // 一半窗口装原材料，另一半容纳旧认知、画像和指令，不预留模型输出。
            if (size >= windowTokens * 0.5) {
              throw new Error(`单条经历材料超过整理输入预算：${material.id}`);
            }
            let used = sizes.get(groupKey) ?? 0;
            if (used + size >= windowTokens * 0.5) {
              batches.push([]);
              used = 0;
            }
            batches.at(-1)!.push(material.id);
            groups.set(groupKey, batches);
            sizes.set(groupKey, used + size);
          }
          job = {
            date: due.format("YYYY-MM-DD"),
            cutoff: due.valueOf(),
            batches: [...groups.values()].flat(),
            index: 0,
            stage: "experiences",
            prepared: null,
          };
          await redis.set(key, JSON.stringify(job));
        }
        if (job) {
          await this.organize(job, key, timezone);
        }
        nextAt = dayjs.tz(`${due.add(1, "day").format("YYYY-MM-DD")} 04:00`, timezone).valueOf();
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

  private async organize(job: DailyMemoryJob, key: string, timezone: string): Promise<void> {
    const redis = await getRedis();
    const collection = await materialCollection();
    while (job.index < job.batches.length) {
      this.stopping.signal.throwIfAborted();
      const ids = job.batches[job.index];
      if (job.stage === "release") {
        // 先保存三类已完成这一事实，再设置 TTL；旧材料立即过期也能恢复此步骤。
        await collection.updateMany({ characterId: this.characterId, id: { $in: ids } }, [
          {
            $set: {
              organized: true,
              expiresAt: { $toDate: { $add: ["$occurredAt", 30 * 86_400_000] } },
            },
          },
        ]);
        job.index += 1;
        job.stage = "experiences";
        job.prepared = null;
        await redis.set(key, JSON.stringify(job));
        continue;
      }
      const materials = await collection
        .find({ characterId: this.characterId, id: { $in: ids } })
        .sort({ occurredAt: 1, id: 1 })
        .toArray();
      if (materials.length !== ids.length) {
        throw new Error("每日整理的来源材料缺失，不能跳过已固定的依据");
      }
      const batchId = createHash("sha256").update(ids.join("\n")).digest("hex");
      if (job.stage === "experiences") {
        if (job.prepared === null) {
          job.prepared = await prepareExperienceMemories(
            this.characterId,
            batchId,
            materials,
            timezone,
            this.stopping.signal,
          );
          await redis.set(key, JSON.stringify(job));
        }
        await saveExperienceMemories(job.prepared);
        job.stage = "cognition";
        await redis.set(key, JSON.stringify(job));
      }
      if (job.stage === "cognition") {
        await organizeSelfCognition(this.characterId, batchId, materials, this.stopping.signal);
        job.stage = "people";
        await redis.set(key, JSON.stringify(job));
      }
      await organizePeople(this.characterId, batchId, materials, this.stopping.signal);
      job.stage = "release";
      await redis.set(key, JSON.stringify(job));
    }
    await coarsenExperiences(this.characterId, timezone, Date.now(), this.stopping.signal);
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
