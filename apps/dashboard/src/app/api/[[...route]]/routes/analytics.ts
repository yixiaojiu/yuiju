import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Hono } from "hono";
import { z } from "zod";
import { getDeployment } from "@/lib/deployment";

dayjs.extend(utc);
dayjs.extend(timezone);

export type AnalyticsEventName = "conversation.planner" | "conversation.replyer" | "llm.request";
export type LlmRequestStatus = "success" | "failed" | "cancelled" | "timeout";
export type AnalyticsEntry = { id: string; eventTime: number } & (
  | {
      eventName: "conversation.planner" | "conversation.replyer";
      eventData: { characterId: string; platform: string; channelId: string; durationMs: number };
    }
  | {
      eventName: "llm.request";
      eventData: {
        group: string;
        host: string;
        provider: string;
        model: string;
        durationMs: number;
        status: LlmRequestStatus;
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        reasoningTokens: number | null;
        finishReason?: string;
        errorName?: string;
        statusCode?: number;
      };
    }
);
export type AnalyticsSummary = {
  total: number;
  averageDurationMs: number | null;
  maxDurationMs: number | null;
  failedCount: number;
  timeoutCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  inputUsageCount: number;
  outputUsageCount: number;
  cacheRequestCount: number;
  cacheHitRate: number | null;
};
export type AnalyticsResponse = {
  entries: AnalyticsEntry[];
  summary: AnalyticsSummary;
  page: number;
  pageSize: number;
};

const queryFields = {
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  page: z.coerce.number().int().positive(),
};
const querySchema = z
  .discriminatedUnion("eventName", [
    z.strictObject({
      ...queryFields,
      eventName: z.enum(["conversation.planner", "conversation.replyer"]),
      channelId: z.string().trim().optional(),
    }),
    z.strictObject({
      ...queryFields,
      eventName: z.literal("llm.request"),
      group: z.enum(["chat", "flash", "strong", "multimodal"]).optional(),
      model: z.string().trim().optional(),
      host: z.string().trim().optional(),
      status: z.enum(["success", "failed", "cancelled", "timeout"]).optional(),
    }),
  ])
  .refine((query) => query.startDate <= query.endDate);

export const analyticsApi = new Hono().get("/", async (c) => {
  const deployment = await getDeployment();
  if (deployment.publicDeployment) {
    return c.notFound();
  }
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "埋点类型、日期范围或筛选条件无效" }, 400);
  }
  const query = parsed.data;
  const start = dayjs.tz(query.startDate, deployment.timezone).toDate();
  // 结束日期包含整个自然日，先算下一天的日期，再按项目时区转换。
  const end = dayjs
    .tz(dayjs(query.endDate).add(1, "day").format("YYYY-MM-DD"), deployment.timezone)
    .toDate();
  const filter = {
    eventName: query.eventName,
    eventTime: { $gte: start, $lt: end },
    ...(query.eventName === "llm.request"
      ? {
          ...(query.group && { "eventData.group": query.group }),
          ...(query.model && { "eventData.model": query.model }),
          ...(query.host && { "eventData.host": query.host }),
          ...(query.status && { "eventData.status": query.status }),
        }
      : {
          "eventData.characterId": deployment.characterId,
          ...(query.channelId && { "eventData.channelId": query.channelId }),
        }),
  };
  const collection = (await getMongoDatabase()).collection(mongoCollectionName("analytics_events"));
  const pageSize = 20;
  // 命中率只使用同时有输入量和缓存量的请求，缺失值不参与分母。
  const hasCacheUsage = {
    $and: [
      { $isNumber: "$eventData.inputTokens" },
      { $gt: ["$eventData.inputTokens", 0] },
      { $isNumber: "$eventData.cacheReadTokens" },
    ],
  };
  const [result] = await collection
    .aggregate<{ entries: AnalyticsEntry[]; summary: AnalyticsSummary[] }>([
      { $match: filter },
      { $sort: { eventTime: -1, _id: -1 } },
      {
        $facet: {
          entries: [
            { $skip: (query.page - 1) * pageSize },
            { $limit: pageSize },
            {
              $project: {
                _id: 0,
                id: { $toString: "$_id" },
                eventName: 1,
                eventData: 1,
                eventTime: { $toLong: "$eventTime" },
              },
            },
          ],
          summary: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                averageDurationMs: { $avg: "$eventData.durationMs" },
                maxDurationMs: { $max: "$eventData.durationMs" },
                failedCount: { $sum: { $cond: [{ $eq: ["$eventData.status", "failed"] }, 1, 0] } },
                timeoutCount: {
                  $sum: { $cond: [{ $eq: ["$eventData.status", "timeout"] }, 1, 0] },
                },
                inputTokens: { $sum: "$eventData.inputTokens" },
                outputTokens: { $sum: "$eventData.outputTokens" },
                inputUsageCount: {
                  $sum: { $cond: [{ $isNumber: "$eventData.inputTokens" }, 1, 0] },
                },
                outputUsageCount: {
                  $sum: { $cond: [{ $isNumber: "$eventData.outputTokens" }, 1, 0] },
                },
                cacheRequestCount: { $sum: { $cond: [hasCacheUsage, 1, 0] } },
                cacheInputTokens: { $sum: { $cond: [hasCacheUsage, "$eventData.inputTokens", 0] } },
                cacheReadTokens: {
                  $sum: { $cond: [hasCacheUsage, "$eventData.cacheReadTokens", 0] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                total: 1,
                averageDurationMs: 1,
                maxDurationMs: 1,
                failedCount: 1,
                timeoutCount: 1,
                inputUsageCount: 1,
                outputUsageCount: 1,
                cacheRequestCount: 1,
                inputTokens: { $cond: [{ $gt: ["$inputUsageCount", 0] }, "$inputTokens", null] },
                outputTokens: { $cond: [{ $gt: ["$outputUsageCount", 0] }, "$outputTokens", null] },
                cacheHitRate: {
                  $cond: [
                    { $gt: ["$cacheInputTokens", 0] },
                    { $divide: ["$cacheReadTokens", "$cacheInputTokens"] },
                    null,
                  ],
                },
              },
            },
          ],
        },
      },
    ])
    .toArray();
  const summary = result.summary.length
    ? result.summary[0]
    : {
        total: 0,
        averageDurationMs: null,
        maxDurationMs: null,
        failedCount: 0,
        timeoutCount: 0,
        inputTokens: null,
        outputTokens: null,
        inputUsageCount: 0,
        outputUsageCount: 0,
        cacheRequestCount: 0,
        cacheHitRate: null,
      };
  return c.json({
    entries: result.entries,
    summary,
    page: query.page,
    pageSize,
  } satisfies AnalyticsResponse);
});
