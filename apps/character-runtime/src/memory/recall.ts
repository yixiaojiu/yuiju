import { load_config } from "@yuiju/shared/config/load";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { mongo } from "mongoose";
import { z } from "zod";
import { type ExperienceMemory, MEMORY_RETENTION_DAYS, memoryCollection } from "./experiences";
import { memoryIndexVersion, searchMemoryChunks } from "./vector-index";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const dateSchema = z.iso.date();
const searchSchema = z.strictObject({
  mode: z.literal("search"),
  query: z.string().min(1),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  limit: z.number().int().min(1).max(20),
});
const readSchema = z.strictObject({
  mode: z.literal("read"),
  startDate: dateSchema,
  endDate: dateSchema,
});

/** 模型接收根对象；两种模式分别校验必填参数，不再将缺 query 隐式解释成日期查询。 */
export const recallSchema = z
  .strictObject({
    mode: z.enum(["search", "read"]).describe("search：语义搜索相关片段；read：按日期读取完整记忆"),
    query: z.string().min(1).optional().describe("search 必填，你想回忆的事情或问题；read 不传"),
    startDate: dateSchema
      .optional()
      .describe("开始日期 YYYY-MM-DD，包含当天；read 必填，search 可选"),
    endDate: dateSchema
      .optional()
      .describe("结束日期 YYYY-MM-DD，包含当天；read 必填，search 可选"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("search 必填，返回的片段数上限；read 不传"),
  })
  .pipe(z.discriminatedUnion("mode", [searchSchema, readSchema]));

const grainNames = { day: "每日记忆", week: "周记忆", month: "月记忆", year: "年记忆" };

/** 日期按项目时区解释；使用自然日边界，夏令时变化不会改变保留天数。 */
export function memoryDateFilter(
  today: string,
  startDate?: string,
  endDate?: string,
): mongo.Filter<ExperienceMemory> {
  const day = dayjs.utc(today);
  const dayBoundary = day.subtract(MEMORY_RETENTION_DAYS.day, "day").format("YYYY-MM-DD");
  const weekBoundary = day.subtract(MEMORY_RETENTION_DAYS.week, "day").format("YYYY-MM-DD");
  const monthBoundary = day.subtract(MEMORY_RETENTION_DAYS.month, "day").format("YYYY-MM-DD");
  return {
    $and: [
      {
        $or: [
          { grain: "day", startDate: { $gte: dayBoundary } },
          { grain: "week", startDate: { $gte: weekBoundary, $lt: dayBoundary } },
          { grain: "month", startDate: { $gte: monthBoundary, $lt: weekBoundary } },
          { grain: "year", startDate: { $lt: monthBoundary } },
        ],
      },
      { endDate: { $lt: today } },
      ...(startDate ? [{ endDate: { $gte: startDate } }] : []),
      ...(endDate ? [{ startDate: { $lte: endDate } }] : []),
    ],
  };
}

/** 主 loop 与 Planner 读取同一份角色记忆；不查询原始素材，也不按群过滤正文。 */
export async function recallExperiences(
  characterId: string,
  input: z.infer<typeof recallSchema>,
): Promise<string> {
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    return "查询未执行：startDate 不能晚于 endDate。";
  }
  const timezone = (await load_config()).app!.timezone!;
  const today = dayjs().tz(timezone).format("YYYY-MM-DD");
  const memories = await (await memoryCollection())
    .find({
      characterId,
      ...memoryDateFilter(today, input.startDate, input.endDate),
    })
    .sort({ startDate: 1, id: 1 })
    .toArray();
  if (!memories.length) {
    return "没有找到已经整理且当前仍可回忆的记忆；当天的经历尚未完成每日整理，缺少记录不表示没有经历过。";
  }
  if (input.mode === "read") {
    return memories
      .map(
        (memory) =>
          `${memory.startDate} 至 ${memory.endDate}（${grainNames[memory.grain]}，完整正文）\n${memory.text}`,
      )
      .join("\n\n");
  }
  const points = await searchMemoryChunks(memories, input.query, input.limit);
  const byVersion = new Map(memories.map((memory) => [memoryIndexVersion(memory), memory]));
  return (
    points
      .map((point) => {
        const payload = z
          .object({ version: z.string(), start: z.number().int(), end: z.number().int() })
          .parse(point.payload);
        const memory = byVersion.get(payload.version)!;
        return `${memory.startDate} 至 ${memory.endDate}（${grainNames[memory.grain]}，相关片段）\n${memory.text.slice(payload.start, payload.end)}`;
      })
      .join("\n\n") || "没有检索到相关记忆片段。"
  );
}
