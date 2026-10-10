import { createHash } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { getQdrant } from "@yuiju/shared/database/qdrant";
import { getEnvironment } from "@yuiju/shared/env/environment";
import { embedTexts } from "@yuiju/shared/llm/embedding";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { flashModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";
import type { ExperienceMemory } from "./experiences";

const chunksSchema = z.strictObject({
  chunks: z
    .array(z.string().trim().min(1).describe("你从正文提取的一个独立可理解、值得检索的记忆片段。"))
    .describe("你筛选后的片段，不需要覆盖全文；没有值得索引的内容时返回空数组。"),
});

/** 只从完整记忆提取检索片段；调用方将结果存入任务草稿，索引重试不重新生成。 */
export async function generateMemoryChunks(
  memory: ExperienceMemory,
  signal?: AbortSignal,
): Promise<string[]> {
  const instructions = await renderPrompt("memory.chunks");
  const prompt = JSON.stringify({
    grain: memory.grain,
    startDate: memory.startDate,
    endDate: memory.endDate,
    text: memory.text,
  });
  const budget = (await load_config()).llm!.models!.flash!.context_window_tokens! * 0.8;
  if (
    Buffer.byteLength(
      instructions + prompt + JSON.stringify(z.toJSONSchema(chunksSchema)),
      "utf8",
    ) >= budget
  ) {
    throw new Error("经历记忆超过片段提取输入预算");
  }
  const result = await generateStructuredOutput({
    model: flashModel,
    instructions,
    prompt,
    output: Output.object({ schema: chunksSchema }),
    abortSignal: signal,
  });
  if (result.finishReason !== "stop") {
    throw new Error(`记忆片段未完整生成：${result.finishReason}`);
  }
  return result.output.chunks;
}

/** 从正文与日期派生，无需在记忆正文中再维护一份版本字段。 */
export function memoryIndexVersion(memory: ExperienceMemory): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        memory.characterId,
        memory.id,
        memory.startDate,
        memory.endDate,
        memory.text,
      ]),
    )
    .digest("hex");
}

function collectionName(): string {
  return getEnvironment() === "production"
    ? "character_memory_chunks"
    : "character_memory_chunks_dev";
}

let initialization: Promise<void> | undefined;

/** 多角色首次写入共用初始化任务，避免同时创建同一个 collection。 */
async function initializeCollection(vectorSize: number): Promise<void> {
  const client = await getQdrant();
  const collection = collectionName();
  if (!(await client.collectionExists(collection)).exists) {
    await client.createCollection(collection, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }
  for (const field of ["characterId", "memoryId", "version"]) {
    await client.createPayloadIndex(collection, {
      field_name: field,
      field_schema: "keyword",
      wait: true,
    });
  }
}

/** 正文保存后调用；片段内容决定点 ID，先写新片段，再删除该篇不再使用的点。 */
export async function indexExperienceMemory(
  memory: ExperienceMemory,
  chunks: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (chunks.length === 0) {
    await removeMemoryIndex(memory.characterId, [memory.id]);
    return;
  }
  const date =
    memory.startDate === memory.endDate
      ? memory.startDate
      : `${memory.startDate} 至 ${memory.endDate}`;
  const grainNames = { day: "每日记忆", week: "周记忆", month: "月记忆", year: "年记忆" };
  const vectors = await embedTexts(
    chunks.map((text) => `日期：${date}\n类型：${grainNames[memory.grain]}\n内容：${text}`),
    { abortSignal: signal },
  );
  const client = await getQdrant();
  const collection = collectionName();
  initialization ??= initializeCollection(vectors[0].length);
  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
  const version = memoryIndexVersion(memory);
  const points = chunks.map((text, index) => {
    const hex = createHash("sha256")
      .update(JSON.stringify([version, index, text]))
      .digest("hex")
      .slice(0, 32);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return {
      id,
      vector: vectors[index],
      payload: {
        characterId: memory.characterId,
        memoryId: memory.id,
        version,
        grain: memory.grain,
        startDate: memory.startDate,
        endDate: memory.endDate,
        chunkIndex: index,
        text,
      },
    };
  });
  await client.upsert(collection, {
    wait: true,
    points,
  });
  await client.delete(collection, {
    wait: true,
    filter: {
      must: [
        { key: "characterId", match: { value: memory.characterId } },
        { key: "memoryId", match: { value: memory.id } },
      ],
      // 同一正文重新提取的片段也可能不同，按本次实际点 ID 清理，避免残留旧片段。
      must_not: [{ has_id: points.map((point) => point.id) }],
    },
  });
}

/** 先由 Mongo 确定当前可回忆的正文版本，过滤后再排序，旧版本不会占用返回名额。 */
export async function searchMemoryChunks(
  memories: ExperienceMemory[],
  query: string,
  limit: number,
) {
  const client = await getQdrant();
  const collection = collectionName();
  // 所有记忆都返回空片段时不会创建 collection，检索结果自然为空。
  if (!(await client.collectionExists(collection)).exists) {
    return [];
  }
  const [vector] = await embedTexts([query]);
  return await client.search(collection, {
    vector,
    limit,
    filter: { must: [{ key: "version", match: { any: memories.map(memoryIndexVersion) } }] },
    with_payload: true,
    with_vector: false,
  });
}

/** 删除指定正文的全部片段，用于空提取结果和归并完成后的细粒度索引清理。 */
export async function removeMemoryIndex(characterId: string, memoryIds: string[]): Promise<void> {
  const client = await getQdrant();
  const collection = collectionName();
  if (!(await client.collectionExists(collection)).exists) {
    return;
  }
  await client.delete(collection, {
    wait: true,
    filter: {
      must: [
        { key: "characterId", match: { value: characterId } },
        { key: "memoryId", match: { any: memoryIds } },
      ],
    },
  });
}
