import { load_config } from "@yuiju/shared/config/load";
import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { flashModel, strongModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import type { ActivityView, PositionView } from "@yuiju/shared/world/protocol";
import { generateText, Output } from "ai";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { stringifyLlmMemory } from "../conversation/platform";
import { characterKey } from "../storage";
import type { PersonMemoryMaterial } from "./people";
import { generateMemoryChunks, indexExperienceMemory, removeMemoryIndex } from "./vector-index";

dayjs.extend(isoWeek);
dayjs.extend(utc);

/** 可追溯的亲历依据；不保存模型隐藏推理，不把上下文摘要作为新事实。 */
export type ExperienceMaterial = {
  id: string;
  occurredAt: number;
  source: "world" | "feeling" | "conversation";
  content: string;
  /** 保留世界回执中的活动起止时间及结束位置，跨日活动按 occurredAt 所在日整理。 */
  activity?: ActivityView;
  position?: PositionView;
  /** 聊天原文在每日整理时转换为输入，不在素材表重复存储。 */
  conversation?: { platform: string; channelId: string };
  people: { platform: string; userId: string; name: string }[];
};

/** 同一次实际经历沿用稳定 id；Redis 接收成功后才允许输入消费，Mongo 不阻塞决策。 */
export async function recordExperience(
  characterId: string,
  material: ExperienceMaterial & { source: "world" | "feeling" },
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
        const material: Omit<StoredMaterial, "characterId"> = JSON.parse(value);
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
  source: "world" | "feeling";
  characterId: string;
  organized?: boolean;
  expiresAt?: Date;
};
/** 一篇普通正文；日期使用项目时区的自然日，向量只是外部派生索引。 */
export type ExperienceMemory = {
  id: string;
  characterId: string;
  grain: "day" | "week" | "month" | "year";
  startDate: string;
  endDate: string;
  text: string;
};

export const MEMORY_RETENTION_DAYS = { day: 7, week: 30, month: 180 };

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

/** ID 对应固定周期；跨月的周仍分段，避免月概括混入另一个月份。 */
export function memoryPeriodId(grain: ExperienceMemory["grain"], date: string): string {
  const day = dayjs.utc(date);
  const period =
    grain === "day"
      ? date
      : grain === "week"
        ? `${day.format("YYYY-MM")}/W${day.isoWeek()}`
        : grain === "month"
          ? day.format("YYYY-MM")
          : day.format("YYYY");
  return `${grain}:${period}`;
}

/** 同一次群聊整理同时产出经历摘要与人物材料；仅保存在每日任务进度中。 */
export type ConversationMemorySummary = {
  platform: string;
  channelId: string;
  text: string;
  people: PersonMemoryMaterial[];
};

/** 同一群的一批原文先压成记忆素材；输入分批与成功后的进度保存由每日任务负责。 */
export async function summarizeMemoryConversation(
  characterId: string,
  date: string,
  materials: ExperienceMaterial[],
  signal: AbortSignal,
): Promise<ConversationMemorySummary> {
  const conversation = materials[0].conversation!;
  const participants = new Map(
    materials.flatMap((material) => material.people).map((person) => [person.userId, person]),
  );
  const schema = z.strictObject({
    text: z.string().trim().min(1).describe("你对本批线上交流的简洁摘要。"),
    people: z.array(
      z.strictObject({
        userId: z
          .string()
          .refine((value) => participants.has(value), "人物必须来自本批发言者列表")
          .describe("材料所属人物的发送者 ID，必须使用 participants 中的 userId。"),
        text: z
          .string()
          .trim()
          .min(1)
          .describe("你提取的有依据的新信息、纠正或重要互动，保留日期、必要原话与对话背景。"),
      }),
    ),
  });
  const instructions = `${await renderPrompt(`character.persona.${characterId}`)}\n\n${await renderPrompt("memory.conversations")}`;
  const prompt = stringifyLlmMemory({
    date,
    ...conversation,
    participants: [...participants.values()].map(({ userId, name }) => ({ userId, name })),
    messages: materials.map((material) => material.content).join("\n"),
  });
  const budget = (await load_config()).llm!.models!.flash!.context_window_tokens! * 0.8;
  if (
    Buffer.byteLength(instructions + prompt + JSON.stringify(z.toJSONSchema(schema)), "utf8") >=
    budget
  ) {
    throw new Error("群聊素材超过记忆压缩窗口");
  }
  const result = await generateStructuredOutput({
    model: flashModel,
    instructions,
    prompt,
    output: Output.object({ schema }),
    abortSignal: signal,
  });
  if (result.finishReason !== "stop") {
    throw new Error("群聊记忆素材未正常生成，保留整理进度");
  }
  return {
    ...conversation,
    text: result.output.text,
    people: result.output.people.map((person) => ({
      platform: conversation.platform,
      userId: person.userId,
      date,
      text: person.text,
    })),
  };
}

/** 分批只更新一篇草稿，生成失败不覆盖已经保存的完整正文。 */
export async function prepareExperienceMemory(
  characterId: string,
  date: string,
  materials: ExperienceMaterial[],
  conversations: ConversationMemorySummary[],
  previousText: string,
  signal: AbortSignal,
): Promise<ExperienceMemory> {
  const instructions = `${await renderPrompt(`character.persona.${characterId}`)}\n\n${await renderPrompt("memory.experiences")}`;
  const prompt = stringifyLlmMemory({
    date,
    previousText,
    materials,
    conversations: conversations.map(({ platform, channelId, text }) => ({
      platform,
      channelId,
      text,
    })),
  });
  const budget = (await load_config()).llm!.models!.strong!.context_window_tokens! * 0.8;
  if (Buffer.byteLength(instructions + prompt, "utf8") >= budget) {
    throw new Error("每日记忆草稿与本批素材超过整理窗口");
  }
  const result = await generateText({
    model: strongModel,
    instructions,
    prompt,
    maxRetries: 0,
    abortSignal: signal,
  });
  if (result.finishReason !== "stop" || !result.text.trim()) {
    throw new Error("每日记忆正文未正常生成，保留原文和整理进度");
  }
  return {
    id: memoryPeriodId("day", date),
    characterId,
    grain: "day",
    startDate: date,
    endDate: date,
    text: result.text.trim(),
  };
}

/** 正文按固定周期覆盖；索引提交由调用方显式执行，并保存恢复进度。 */
export async function saveExperienceMemory(memory: ExperienceMemory): Promise<void> {
  const collection = await memoryCollection();
  await collection.createIndex({ characterId: 1, id: 1 }, { unique: true });
  await collection.createIndex({ characterId: 1, grain: 1, startDate: 1 });
  await collection.replaceOne({ characterId: memory.characterId, id: memory.id }, memory, {
    upsert: true,
  });
}

/** 粗记忆已经生成后，索引失败与删除失败都使用这份草稿继续，不再次总结来源。 */
type MemoryMerge = {
  memory: ExperienceMemory;
  sourceIds: string[];
  /** 成功提取后保留片段，embedding 或索引删除失败时直接复用。 */
  chunks: string[] | null;
};

/** 从最旧日期判断是否到期；整篇向更粗粒度归并，不留下过期细节供检索。 */
export async function coarsenExperiences(
  characterId: string,
  today: string,
  signal: AbortSignal,
): Promise<void> {
  const redis = await getRedis();
  const key = `${characterKey(characterId)}:memory:merge`;
  const collection = await memoryCollection();
  const instructions = await renderPrompt("memory.coarsen");
  const inputBudget = (await load_config()).llm!.models!.strong!.context_window_tokens! * 0.8;
  while (true) {
    signal.throwIfAborted();
    const stored = await redis.get(key);
    let merge: MemoryMerge | null = stored === null ? null : JSON.parse(stored);
    if (!merge) {
      // 每次完成一组再查询；刚形成的周/月概括也可能因长期停机而需要继续归并。
      const expired = await collection
        .find({
          characterId,
          $or: (["day", "week", "month"] as const).map((grain) => ({
            grain,
            startDate: {
              $lt: dayjs
                .utc(today)
                .subtract(MEMORY_RETENTION_DAYS[grain], "day")
                .format("YYYY-MM-DD"),
            },
          })),
        })
        .sort({ startDate: 1, id: 1 })
        .toArray();
      if (!expired.length) {
        return;
      }
      const first = expired[0];
      const grain = first.grain === "day" ? "week" : first.grain === "week" ? "month" : "year";
      const id = memoryPeriodId(grain, first.startDate);
      const previous = await collection.findOne({ characterId, id });
      const incoming = expired.filter(
        (record) => record.grain === first.grain && memoryPeriodId(grain, record.startDate) === id,
      );
      const sources: ExperienceMemory[] = previous ? [previous] : [];
      const sourceIds: string[] = [];
      let size = Buffer.byteLength(instructions + stringifyLlmMemory(sources), "utf8");
      for (const memory of incoming) {
        const bytes = Buffer.byteLength(stringifyLlmMemory(memory), "utf8");
        if (size + bytes >= inputBudget) {
          break;
        }
        sources.push(memory);
        sourceIds.push(memory.id);
        size += bytes;
      }
      if (!sourceIds.length) {
        throw new Error("旧概括与最小记忆正文超过归并窗口");
      }
      const result = await generateText({
        model: strongModel,
        instructions,
        prompt: stringifyLlmMemory({ grain, memories: sources }),
        maxRetries: 0,
        abortSignal: signal,
      });
      if (result.finishReason !== "stop" || !result.text.trim()) {
        throw new Error("经历概括未正常完成，保留较细记忆");
      }
      merge = {
        sourceIds,
        chunks: null,
        memory: {
          id,
          characterId,
          grain,
          startDate: sources.map((source) => source.startDate).sort()[0],
          endDate: sources
            .map((source) => source.endDate)
            .sort()
            .at(-1)!,
          text: result.text.trim(),
        },
      };
      await redis.set(key, JSON.stringify(merge));
    }
    await saveExperienceMemory(merge.memory);
    if (merge.chunks === null) {
      merge.chunks = await generateMemoryChunks(merge.memory, signal);
      await redis.set(key, JSON.stringify(merge));
    }
    await indexExperienceMemory(merge.memory, merge.chunks, signal);
    await removeMemoryIndex(characterId, merge.sourceIds);
    await collection.deleteMany({ characterId, id: { $in: merge.sourceIds } });
    await redis.del(key);
  }
}
