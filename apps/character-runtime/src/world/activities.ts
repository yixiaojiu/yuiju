import { load_config } from "@yuiju/shared/config/load";
import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { truncateToolOutput } from "@yuiju/shared/llm/tool-output";
import { logger } from "@yuiju/shared/logger/logger";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import { tool } from "ai";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const todayActivitiesSchema = z.strictObject({
  keyword: z.string().trim().min(1).optional().describe("你查询的关键词，匹配活动名称或事件描述"),
  startTime: timeSchema.optional().describe("当天开始时间 HH:mm，包含该分钟；省略为当天 00:00"),
  endTime: timeSchema
    .optional()
    .describe("当天结束时间 HH:mm，包含该分钟且不超过查询时刻；省略为当前时间"),
  limit: z.number().int().min(1).max(100).optional().describe("最多返回多少条事件，省略为 20 条"),
});

/** 主 agent 与 Planner 共用定义；执行时由宿主绑定角色，不接受日期或其他角色 ID。 */
export const queryTodayActivitiesTool = tool({
  description:
    "你可以查询自己今天已经归档的活动开始、完成事件，包括发生时间、活动名称及结果。时间按项目时区解释，只能查询当天截至现在的记录；过往经历使用 recall。开始与完成各算一条事件，超过条数时取最近的记录并按时间正序展示。输出过长会省略中间内容，可用时间或关键词缩小范围。归档存在短暂延迟，没有记录不代表没有发生。",
  inputSchema: todayActivitiesSchema,
  toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
});

type ActivityEvent = {
  eventId: string;
  characterId: string;
  occurredAt: number;
  type: "activity_started" | "activity_completed";
  activity: { actionId: string } | null;
  description: string;
};

/** 只读查询当前角色的当天事件；按 occurredAt 限制，跨日活动不返回昨天的开始记录。 */
export async function queryTodayActivities(
  characterId: string,
  input: z.infer<typeof todayActivitiesSchema>,
): Promise<string> {
  const timezone = (await load_config()).app!.timezone!;
  const now = Date.now();
  const date = dayjs(now).tz(timezone).format("YYYY-MM-DD");
  const start = dayjs.tz(`${date} ${input.startTime ?? "00:00"}`, timezone).valueOf();
  const end = input.endTime ? dayjs.tz(`${date} ${input.endTime}`, timezone).valueOf() : now;
  if (start > end || end > now) {
    return "查询未执行：开始时间不能晚于结束时间，时间范围不能超过当前时刻；只能传当天的 HH:mm。";
  }
  // 结束分钟包含整分钟；当前分钟只读到本次查询时刻，不放行未来的记录。
  const endExclusive = input.endTime ? Math.min(end + 60_000, now + 1) : now + 1;
  const limit = input.limit ?? 20;
  const keyword = input.keyword?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let records: ActivityEvent[];
  try {
    const collection = (await getMongoDatabase()).collection<ActivityEvent>(
      mongoCollectionName("world_events"),
    );
    records = await collection
      .find(
        {
          characterId,
          type: { $in: ["activity_started", "activity_completed"] },
          activity: { $ne: null },
          occurredAt: { $gte: start, $lt: endExclusive },
          ...(keyword
            ? {
                $or: [
                  { "activity.actionId": { $regex: keyword, $options: "i" } },
                  { description: { $regex: keyword, $options: "i" } },
                ],
              }
            : {}),
        },
        { projection: { occurredAt: 1, type: 1, "activity.actionId": 1, description: 1 } },
      )
      .sort({ occurredAt: -1, type: 1, eventId: -1 })
      // 多取一条判断是否还有记录，不另外执行总数查询。
      .limit(limit + 1)
      .toArray();
  } catch (error) {
    logger.error("当天活动查询失败", { error });
    return `活动查询未成功：${error instanceof Error ? error.message : String(error)}`;
  }
  const range = `查询范围：${formatLlmDateTime(start, timezone)} 至 ${formatLlmDateTime(endExclusive - 1, timezone)}`;
  if (!records.length) {
    return `${range}\n没有找到已归档的活动记录；最新事件可能尚未归档，未命中不代表没有发生。`;
  }
  return [
    range,
    records.length > limit
      ? `仅返回最近 ${limit} 条事件，还有更早的匹配记录；可缩小时间范围或使用关键词。`
      : `共 ${records.length} 条事件。`,
    ...records
      .slice(0, limit)
      .reverse()
      .map(
        (record) =>
          `${formatLlmDateTime(record.occurredAt, timezone)}｜${record.activity!.actionId}｜${record.type === "activity_started" ? "开始" : "完成"}\n${record.description}`,
      ),
  ].join("\n\n");
}
