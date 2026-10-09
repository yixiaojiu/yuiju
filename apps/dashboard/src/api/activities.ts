import type { ActivityRecord } from "@yuiju/shared/dashboard/types";
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

export type ActivityEntry = {
  id: string;
  action: string;
  startedAt: number;
  endsAt: number | null;
  completedAt: number | null;
  description: string;
};
export type ActivitiesResponse = {
  activities: ActivityEntry[];
  actions: string[];
  page: number;
  pageSize: number;
  total: number;
};
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => dayjs(date).format("YYYY-MM-DD") === date);
const querySchema = z
  .object({
    startDate: dateSchema,
    endDate: dateSchema,
    action: z.string().optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive(),
  })
  .refine((query) => query.startDate <= query.endDate);

export const activitiesApi = new Hono().get("/", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "日期范围或页码无效" }, 400);
  }
  const { startDate, endDate, page, action, keyword } = parsed.data;
  const deployment = await getDeployment();
  const start = dayjs.tz(startDate, deployment.timezone).valueOf();
  const end = dayjs
    .tz(dayjs(endDate).add(1, "day").format("YYYY-MM-DD"), deployment.timezone)
    .valueOf();
  const collection = (await getMongoDatabase(deployment.source)).collection<ActivityRecord>(
    mongoCollectionName("world_events"),
  );
  const pageSize = 20;
  const search = keyword?.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = {
    ...(action ? { action } : {}),
    ...(search
      ? {
          $or: [
            { action: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ],
        }
      : {}),
  };
  // 先完整归并一次活动，再按实际时间、名称及结果筛选，最后分页。
  // 跨午夜的活动会出现在经过的自然日，不把不同日期的开始、完成拆成两条。
  const [result] = await collection
    .aggregate<{
      activities: ActivityEntry[];
      count: { total: number }[];
      actions: { _id: string }[];
    }>([
      {
        $match: {
          characterId: deployment.characterId,
          type: { $in: ["activity_started", "activity_completed"] },
          "activity.startedAt": { $lt: end },
          activity: { $ne: null },
        },
      },
      { $sort: { occurredAt: 1, type: -1 } },
      {
        $group: {
          _id: "$activity.activityId",
          action: { $first: "$activity.actionId" },
          startedAt: { $first: "$activity.startedAt" },
          endsAt: { $first: "$activity.endsAt" },
          completedAt: {
            $max: { $cond: [{ $eq: ["$type", "activity_completed"] }, "$occurredAt", null] },
          },
          description: { $last: "$description" },
        },
      },
      {
        $match: {
          $or: [
            { startedAt: { $gte: start } },
            { completedAt: { $gte: start } },
            { completedAt: null, endsAt: { $gte: start } },
          ],
        },
      },
      {
        $facet: {
          actions: [{ $group: { _id: "$action" } }, { $sort: { _id: 1 } }],
          count: [{ $match: filter }, { $count: "total" }],
          activities: [
            { $match: filter },
            { $sort: { startedAt: -1, _id: 1 } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              $project: {
                _id: 0,
                id: "$_id",
                action: 1,
                startedAt: 1,
                endsAt: 1,
                completedAt: 1,
                description: 1,
              },
            },
          ],
        },
      },
    ])
    .toArray();
  return c.json({
    activities: result.activities,
    actions: result.actions.map((item) => item._id),
    total: result.count.length ? result.count[0].total : 0,
    page,
    pageSize,
  } satisfies ActivitiesResponse);
});
