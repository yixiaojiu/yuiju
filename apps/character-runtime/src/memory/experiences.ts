import { createHash } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { embedTexts } from "@yuiju/shared/llm/embedding";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { strongModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, Output } from "ai";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { stringifyLlmMemory } from "../conversation/platform";
import { characterKey } from "../storage";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);
dayjs.extend(isoWeek);

/** 可追溯的亲历依据；不保存模型隐藏推理，不把上下文摘要作为新事实。 */
export type ExperienceMaterial = {
  id: string;
  occurredAt: number;
  source: "world" | "action" | "feeling" | "conversation";
  content: string;
  /** 群聊来源只能用于原会话的回忆与披露。世界亲历没有群范围。 */
  conversation?: { platform: string; channelId: string };
  people: { platform: string; userId: string; name: string }[];
};

/** 同一次实际经历沿用稳定 id；Redis 接收成功后才允许输入消费，Mongo 不阻塞决策。 */
export async function recordExperience(
  characterId: string,
  material: ExperienceMaterial,
): Promise<void> {
  await (await getRedis()).hsetnx(
    `${characterKey(characterId)}:memory:pending`,
    material.id,
    JSON.stringify(material),
  );
}

/** Mongo 按来源 id 幂等写入；成功后删除该批，不影响并发到达的新材料。 */
export async function archiveExperiences(characterId: string): Promise<void> {
  const redis = await getRedis();
  const key = `${characterKey(characterId)}:memory:pending`;
  const entries = Object.entries(await redis.hgetall(key));
  if (!entries.length) {
    return;
  }
  const collection = await materialCollection();
  await collection.createIndex({ characterId: 1, id: 1 }, { unique: true });
  await collection.createIndex({ characterId: 1, occurredAt: 1 });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = entries.slice(offset, offset + 100);
    await collection.bulkWrite(
      batch.map(([, value]) => {
        const material: ExperienceMaterial = JSON.parse(value);
        return {
          updateOne: {
            filter: { characterId, id: material.id },
            update: { $setOnInsert: { ...material, characterId } },
            upsert: true,
          },
        };
      }),
    );
    await redis.hdel(key, ...batch.map(([id]) => id));
  }
}

export type StoredMaterial = ExperienceMaterial & {
  characterId: string;
  organized?: boolean;
  expiresAt?: Date;
};
export type ExperienceMemory = {
  id: string;
  characterId: string;
  grain: "detail" | "week" | "month" | "year";
  period: string;
  from: number;
  through: number;
  availableAt: number;
  text: string;
  embedding: number[];
  conversation?: { platform: string; channelId: string };
  /** 合并后待清理的较细记录；不提供按来源 ID 读取细节的工具。 */
  replaces: string[];
  /** 内部感受可能含跨会话原因，只供角色决策回忆，不自动进入群聊检索。 */
  privateToCharacter: boolean;
};
const dayMs = 86_400_000;
const grainDays = { detail: 7, week: 30, month: 180, year: Infinity };

export async function materialCollection() {
  return (await getMongoDatabase()).collection<StoredMaterial>(
    mongoCollectionName("character_materials"),
  );
}
export async function memoryCollection() {
  return (await getMongoDatabase()).collection<ExperienceMemory>(
    mongoCollectionName("character_memories"),
  );
}

/** 同日、同来源材料整理为若干往事，元信息由实际来源计算。 */
export async function prepareExperienceMemories(
  characterId: string,
  batchId: string,
  materials: ExperienceMaterial[],
  timezone: string,
  signal: AbortSignal,
): Promise<ExperienceMemory[]> {
  const result = await generateStructuredOutput({
    model: strongModel,
    output: Output.object({
      schema: z.strictObject({
        memories: z
          .array(
            z.strictObject({
              text: z.string().min(1).max(1200),
              sourceIds: z.array(z.string()).min(1),
            }),
          )
          .max(40),
      }),
    }),
    instructions: await renderPrompt("memory.experiences"),
    prompt: stringifyLlmMemory(materials),
    abortSignal: signal,
  });
  const records = result.output.memories.map((memory, index) => {
    const sources = memory.sourceIds.map((id) => {
      const source = materials.find((material) => material.id === id);
      if (!source) {
        throw new Error(`经历记忆引用了不存在的来源：${id}`);
      }
      return source;
    });
    const from = Math.min(...sources.map((source) => source.occurredAt));
    return {
      id: `${batchId}:${index}`,
      characterId,
      grain: "detail" as const,
      period: dayjs(from).tz(timezone).format("YYYY-MM-DD"),
      from,
      through: Math.max(...sources.map((source) => source.occurredAt)),
      availableAt: from,
      text: memory.text,
      privateToCharacter: materials[0].source === "feeling",
      conversation: materials[0].conversation,
      replaces: [],
    };
  });
  if (!records.length) {
    return [];
  }
  const embeddings = await embedTexts(
    records.map((record) => record.text),
    { abortSignal: signal },
  );
  return records.map((record, index) => ({ ...record, embedding: embeddings[index] }));
}

export async function saveExperienceMemories(records: ExperienceMemory[]): Promise<void> {
  if (!records.length) {
    return;
  }
  const collection = await memoryCollection();
  await collection.createIndex({ characterId: 1, id: 1 }, { unique: true });
  await collection.createIndex({ characterId: 1, grain: 1, from: 1 });
  await collection.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { characterId: record.characterId, id: record.id },
        update: { $setOnInsert: record },
        upsert: true,
      },
    })),
  );
}

/** 先写粗记忆再清理来源；未越过遗忘阈值的原文仍保留，到期再删除。 */
async function finishMemoryReplacements(characterId: string, now: number): Promise<void> {
  const collection = await memoryCollection();
  for (const record of await collection
    .find({ characterId, "replaces.0": { $exists: true } })
    .toArray()) {
    const sources = await collection.find({ characterId, id: { $in: record.replaces } }).toArray();
    const expired = sources.filter(
      (source) =>
        source.grain === record.grain || source.from + grainDays[source.grain] * dayMs < now,
    );
    if (expired.length) {
      await collection.deleteMany({ characterId, id: { $in: expired.map((source) => source.id) } });
    }
    await collection.updateOne(
      { characterId, id: record.id },
      {
        $set: {
          replaces: sources
            .filter((source) => !expired.includes(source))
            .map((source) => source.id),
        },
      },
    );
  }
}

/** 提前一天准备会到期的概括；查询仍按实际发生时间独立限制粒度。 */
export async function coarsenExperiences(
  characterId: string,
  timezone: string,
  now: number,
  signal: AbortSignal,
): Promise<void> {
  const collection = await memoryCollection();
  const inputBudget = (await load_config()).llm!.models!.strong!.context_window_tokens! * 0.8;
  await finishMemoryReplacements(characterId, now);
  for (const grain of ["detail", "week", "month"] as const) {
    const all = await collection.find({ characterId }).toArray();
    const covered = new Set(all.flatMap((record) => record.replaces));
    const nextGrain = grain === "detail" ? "week" : grain === "week" ? "month" : "year";
    const groups = new Map<string, ExperienceMemory[]>();
    for (const record of all) {
      if (
        record.grain !== grain ||
        covered.has(record.id) ||
        record.from + grainDays[grain] * dayMs > now + dayMs
      ) {
        continue;
      }
      const date = dayjs(record.from).tz(timezone);
      // 跨月周分段，月、年概括不会混入另一个月份或年份。
      const period =
        nextGrain === "week"
          ? `${date.format("YYYY-MM")}/W${date.isoWeek()}`
          : nextGrain === "month"
            ? date.format("YYYY-MM")
            : date.format("YYYY");
      const key = JSON.stringify([period, record.conversation ?? null, record.privateToCharacter]);
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
    for (const [key, incoming] of groups) {
      const [period] = JSON.parse(key) as [string];
      const conversation = incoming[0].conversation;
      const privateToCharacter = incoming[0].privateToCharacter;
      const instructions = await renderPrompt("memory.coarsen", {
        grain: nextGrain === "week" ? "周" : nextGrain === "month" ? "月" : "年",
      });
      while (incoming.length) {
        signal.throwIfAborted();
        // 一个时期的积压也可能超过窗口，分批合入同一概括；每批落库后再继续。
        const existing = (
          await collection.find({ characterId, grain: nextGrain, period }).toArray()
        ).filter(
          (record) =>
            record.privateToCharacter === privateToCharacter &&
            JSON.stringify(record.conversation ?? null) === JSON.stringify(conversation ?? null),
        );
        const sources: ExperienceMemory[] = [...existing];
        let bytes = Buffer.byteLength(
          instructions + existing.map((record) => `${record.period}：${record.text}`).join("\n\n"),
          "utf8",
        );
        let consumed = 0;
        for (const record of incoming) {
          const size = Buffer.byteLength(`${record.period}：${record.text}\n\n`, "utf8");
          if (bytes + size >= inputBudget) {
            break;
          }
          sources.push(record);
          bytes += size;
          consumed += 1;
        }
        if (consumed === 0) {
          throw new Error("记忆概括与最小新增单位超过输入预算，保留来源记录");
        }
        const id = createHash("sha256")
          .update(
            sources
              .map((record) => record.id)
              .sort()
              .join("\n"),
          )
          .digest("hex");
        const result = await generateText({
          model: strongModel,
          instructions,
          prompt: sources.map((record) => `${record.period}：${record.text}`).join("\n\n"),
          maxRetries: 0,
          abortSignal: signal,
        });
        if (result.finishReason !== "stop" || !result.text.trim()) {
          throw new Error("经历概括未正常完成，保留较细记录");
        }
        const [embedding] = await embedTexts([result.text.trim()], { abortSignal: signal });
        await saveExperienceMemories([
          {
            id,
            characterId,
            grain: nextGrain,
            period,
            from: Math.min(...sources.map((source) => source.from)),
            through: Math.max(...sources.map((source) => source.through)),
            availableAt: Math.min(
              ...sources.map((source) =>
                source.grain === nextGrain
                  ? source.availableAt
                  : source.from + grainDays[source.grain] * dayMs,
              ),
            ),
            text: result.text.trim(),
            embedding,
            conversation,
            privateToCharacter,
            replaces: [...new Set(sources.flatMap((source) => [source.id, ...source.replaces]))],
          },
        ]);
        await finishMemoryReplacements(characterId, now);
        incoming.splice(0, consumed);
      }
    }
  }
}

export const recallSchema = z.strictObject({
  query: z.string().min(1).optional().describe("你想起的事情或问题；不填时按时间回顾"),
  since: z.number().int().optional().describe("经历起始时间，Unix 毫秒"),
  until: z.number().int().optional().describe("经历截止时间，Unix 毫秒"),
  limit: z.number().int().min(1).max(20),
});

/** 时间与语义查询共用粒度、角色和会话限制，不开放原材料反查。 */
export async function recallExperiences(
  characterId: string,
  input: z.infer<typeof recallSchema>,
  scope?: { platform: string; channelId: string },
): Promise<string> {
  const now = Date.now();
  const records = (
    await (await memoryCollection()).find({ characterId, availableAt: { $lte: now } }).toArray()
  ).filter((record) => {
    const age = now - record.from;
    const allowed =
      record.grain === "detail"
        ? age <= 7 * dayMs
        : record.grain === "week"
          ? age > 7 * dayMs && age <= 30 * dayMs
          : record.grain === "month"
            ? age > 30 * dayMs && age <= 180 * dayMs
            : age > 180 * dayMs;
    return (
      allowed &&
      (!scope || !record.privateToCharacter) &&
      (input.since === undefined || record.through >= input.since) &&
      (input.until === undefined || record.from <= input.until) &&
      (!scope ||
        !record.conversation ||
        (record.conversation.platform === scope.platform &&
          record.conversation.channelId === scope.channelId))
    );
  });
  if (input.query && records.length) {
    const [query] = await embedTexts([input.query]);
    const similarity = (record: ExperienceMemory) => {
      if (record.embedding.length !== query.length) {
        throw new Error("记忆向量维度与查询模型不一致，需要重新索引");
      }
      let dot = 0;
      let left = 0;
      let right = 0;
      for (let index = 0; index < query.length; index++) {
        dot += query[index] * record.embedding[index];
        left += query[index] ** 2;
        right += record.embedding[index] ** 2;
      }
      return dot / Math.sqrt(left * right);
    };
    const scores = new Map(records.map((record) => [record.id, similarity(record)]));
    records.sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);
  } else {
    records.sort((a, b) => b.through - a.through);
  }
  return (
    records
      .slice(0, input.limit)
      .map((record) => `${record.period}（${record.grain}）：${record.text}`)
      .join("\n\n") || "没有找到当前还能回忆的相关往事。"
  );
}
