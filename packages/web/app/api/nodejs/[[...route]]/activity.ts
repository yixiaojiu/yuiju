import { getYuijuConfig, type MongoReadSource } from "@yuiju/utils";
import { Hono } from "hono";
import {
  ACTIVITY_TYPES,
  type ActivityEpisodeTypeFilter,
  type ActivityTriggerFilter,
  normalizeActivityPage,
  normalizeActivityPageSize,
  queryActivityEvents,
} from "@/lib/activity/activity-query";
import { rejectPublicRequest } from "./public-guard";

export const activityRoute = new Hono();

const parsePage = (value: string | undefined) => {
  if (!value) return normalizeActivityPage(undefined);
  const parsed = Number.parseInt(value, 10);
  return normalizeActivityPage(parsed);
};

const parsePageSize = (value: string | undefined) => {
  if (!value) return normalizeActivityPageSize(undefined);
  const parsed = Number.parseInt(value, 10);
  return normalizeActivityPageSize(parsed);
};

const parseDate = (value: string | undefined) => {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
};

const parseTrigger = (value: string | undefined): ActivityTriggerFilter => {
  if (value === "agent" || value === "user" || value === "system") return value;
  return "all";
};

const parseEpisodeType = (value: string | undefined): ActivityEpisodeTypeFilter => {
  if (ACTIVITY_TYPES.some((item) => item === value)) {
    return value as ActivityEpisodeTypeFilter;
  }
  return "all";
};

activityRoute.get("/activity", async (context) => {
  const page = parsePage(context.req.query("page"));
  const pageSize = parsePageSize(context.req.query("pageSize"));
  const startDate = parseDate(context.req.query("startDate"));
  const endDate = parseDate(context.req.query("endDate"));
  const trigger = parseTrigger(context.req.query("trigger"));
  const episodeType = parseEpisodeType(context.req.query("episodeType"));
  const keyword = context.req.query("keyword")?.trim();
  const readFrom: MongoReadSource = getYuijuConfig().app.publicDeployment ? "sync" : "primary";
  const { events, pagination } = await queryActivityEvents({
    page,
    pageSize,
    startDate,
    endDate,
    trigger,
    episodeType,
    keyword,
    readFrom,
  });

  return context.json({
    code: 0,
    data: {
      events,
      pagination,
    },
    message: "ok",
  });
});
