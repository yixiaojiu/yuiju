import type { Tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { searchDiaries, searchEpisodes } from "../../memory";

const todayEventSearchInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).optional().describe("返回结果上限，默认 10"),
  startHour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .describe("开始小时，例如 15 表示 15:00:00。"),
  endHour: z.number().int().min(0).max(23).optional().describe("结束小时，例如 18 表示 18:59:59。"),
  timeSort: z.enum(["asc", "desc"]).optional().describe("asc时间正序，desc时间倒序。"),
});

const diarySearchInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).optional().describe("返回结果上限，默认 5。"),
  startDate: z.string().optional().describe("开始日期，格式 YYYY-MM-DD。"),
  endDate: z.string().optional().describe("结束日期，格式 YYYY-MM-DD。"),
});

export const todayEventSearchTool: Tool = {
  description: "查询今天发生过的事",
  inputSchema: todayEventSearchInputSchema,
  execute: async (input) => {
    const today = dayjs();
    const result = await searchEpisodes({
      limit: input.limit,
      startTime:
        input.startHour === undefined
          ? undefined
          : today.hour(input.startHour).minute(0).second(0).format("YYYY-MM-DD HH:mm:ss"),
      endTime:
        input.endHour === undefined
          ? undefined
          : today.hour(input.endHour).minute(59).second(59).format("YYYY-MM-DD HH:mm:ss"),
      timeSort: input.timeSort ?? "desc",
    });
    return result;
  },
};

export const diarySearchTool: Tool = {
  description:
    "查询昨天及更早的日记。可按自然日范围筛选；不用于今天的事件查询，也不用于长期事实查询。",
  inputSchema: diarySearchInputSchema,
  execute: async (input) => {
    const result = await searchDiaries({
      limit: input.limit,
      startTime: input.startDate ? `${input.startDate} 00:00:00` : undefined,
      endTime: input.endDate ? `${input.endDate} 23:59:59` : undefined,
    });
    return result;
  },
};
