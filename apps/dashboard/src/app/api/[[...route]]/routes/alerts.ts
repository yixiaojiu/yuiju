import { queryMonitoringAlerts } from "@yuiju/shared/monitoring/storage";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Hono } from "hono";
import { z } from "zod";
import { getDeployment } from "@/lib/deployment";
import { getQueryCharacter } from "../character-query";

dayjs.extend(utc);
dayjs.extend(timezone);

const querySchema = z
  .strictObject({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    characterId: z.string().min(1).optional(),
    monitorKey: z.string().trim().min(1).optional(),
    severity: z.enum(["warning", "error"]).optional(),
    page: z.coerce.number().int().positive().default(1),
  })
  .refine((query) => query.startDate <= query.endDate);

export const alertsApi = new Hono().get("/", async (c) => {
  const deployment = await getDeployment();
  if (deployment.publicDeployment) {
    return c.notFound();
  }
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "日期范围或告警筛选条件无效" }, 400);
  }
  const query = parsed.data;
  if (query.characterId !== undefined) {
    getQueryCharacter(query.characterId, deployment.characters);
  }
  const start = dayjs.tz(query.startDate, deployment.timezone).toDate();
  const end = dayjs
    .tz(dayjs(query.endDate).add(1, "day").format("YYYY-MM-DD"), deployment.timezone)
    .toDate();
  return c.json(await queryMonitoringAlerts({ ...query, start, end }));
});
