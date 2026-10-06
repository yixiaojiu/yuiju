import { createHash } from "node:crypto";
import { getQdrant } from "@yuiju/shared/database/qdrant";
import { getEnvironment } from "@yuiju/shared/env/environment";
import { embedTexts } from "@yuiju/shared/llm/embedding";
import type { ExperienceMemory } from "./experiences";

/** 索引位置使用 JS 字符串偏移，可直接 slice 回完整正文；字符数按 Unicode 字符计算。 */
export type MemoryChunk = { start: number; end: number; text: string };

/** 按空行分段；不足 50 字符向后合并，短尾段向前合并，不拆长段、不重叠。 */
export function splitMemoryText(text: string): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  let start = 0;
  for (const separator of text.matchAll(/\r?\n(?:[\t ]*\r?\n)+/gu)) {
    const end = separator.index;
    if ([...text.slice(start, end).trim()].length >= 50) {
      chunks.push({ start, end, text: text.slice(start, end) });
      start = end + separator[0].length;
    }
  }
  const tail = text.slice(start);
  if ([...tail.trim()].length < 50 && chunks.length) {
    const last = chunks[chunks.length - 1];
    last.end = text.length;
    last.text = text.slice(last.start);
  } else if (tail.trim()) {
    chunks.push({ start, end: text.length, text: tail });
  }
  return chunks;
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

/** 正文保存后调用；同一版本重试覆盖相同点，写完新版本后才移除该篇旧片段。 */
export async function indexExperienceMemory(
  memory: ExperienceMemory,
  signal?: AbortSignal,
): Promise<void> {
  const chunks = splitMemoryText(memory.text);
  const vectors = await embedTexts(
    chunks.map((chunk) => `${memory.startDate} 至 ${memory.endDate}\n${chunk.text}`),
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
  await client.upsert(collection, {
    wait: true,
    points: chunks.map((chunk, index) => {
      const hex = createHash("sha256").update(`${version}:${index}`).digest("hex").slice(0, 32);
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
          ...chunk,
        },
      };
    }),
  });
  await client.delete(collection, {
    wait: true,
    filter: {
      must: [
        { key: "characterId", match: { value: memory.characterId } },
        { key: "memoryId", match: { value: memory.id } },
      ],
      must_not: [{ key: "version", match: { value: version } }],
    },
  });
}

/** 先由 Mongo 确定当前可回忆的正文版本，过滤后再排序，旧版本不会占用返回名额。 */
export async function searchMemoryChunks(
  memories: ExperienceMemory[],
  query: string,
  limit: number,
) {
  const [vector] = await embedTexts([query]);
  const client = await getQdrant();
  return await client.search(collectionName(), {
    vector,
    limit,
    filter: { must: [{ key: "version", match: { any: memories.map(memoryIndexVersion) } }] },
    with_payload: true,
    with_vector: false,
  });
}

/** 由归并任务在粗记忆及索引均已保存后清理细粒度索引。 */
export async function removeMemoryIndex(characterId: string, memoryIds: string[]): Promise<void> {
  await (await getQdrant()).delete(collectionName(), {
    wait: true,
    filter: {
      must: [
        { key: "characterId", match: { value: characterId } },
        { key: "memoryId", match: { any: memoryIds } },
      ],
    },
  });
}
