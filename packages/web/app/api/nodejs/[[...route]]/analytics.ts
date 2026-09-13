import { findAnalyticsEvents } from "@yuiju/utils/db/operations/analytics-event";
import { Hono } from "hono";
import type { ChatReplyPerformanceData, ChatReplyPerformanceEvent } from "@/lib/api/analytics";
import { rejectPublicRequest } from "./public-guard";

interface ChatReplyPerformanceEventData {
  [key: string]: unknown;
  trigger_type: string;
  action_type: string;
  outcome: string;
  total_duration_ms: number;
  first_reply_duration_ms?: number;
  planner_duration_ms: number;
  replyer_duration_ms: number;
  wait_duration_ms: number;
  platform_send_duration_ms: number;
  sent_message_count: number;
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

export const analyticsRoute = new Hono();

analyticsRoute.use("*", async (context, next) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }
  await next();
});

analyticsRoute.get("/chat-reply-performance", async (context) => {
  const startTimeValue = context.req.query("start_time");
  const endTimeValue = context.req.query("end_time");
  const isDevValue = context.req.query("is_dev");
  if (!startTimeValue || !endTimeValue || (isDevValue !== "true" && isDevValue !== "false")) {
    throw new Error("start_time、end_time、is_dev 是必填查询参数");
  }
  const startTime = new Date(startTimeValue);
  const endTime = new Date(endTimeValue);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error("start_time、end_time 必须是合法时间");
  }
  const isDev = isDevValue === "true";
  const documents = await findAnalyticsEvents({
    event_name: "chat_reply_performance",
    start_time: startTime,
    end_time: endTime,
    is_dev: isDev,
  });
  const events = documents.map((document) => document.event_data as ChatReplyPerformanceEventData);
  const totalDurations = events.map((event) => event.total_duration_ms);
  const firstReplyDurations = events.flatMap((event) =>
    event.first_reply_duration_ms === undefined ? [] : [event.first_reply_duration_ms],
  );
  const outcomeCounts = new Map<string, number>();
  const triggerCounts = new Map<string, number>();
  for (const event of events) {
    outcomeCounts.set(event.outcome, (outcomeCounts.get(event.outcome) ?? 0) + 1);
    triggerCounts.set(event.trigger_type, (triggerCounts.get(event.trigger_type) ?? 0) + 1);
  }

  const recentEvents: ChatReplyPerformanceEvent[] = documents.slice(0, 100).map((document) => {
    const event = document.event_data as ChatReplyPerformanceEventData;
    return {
      id: document.id,
      event_time: document.event_time.toISOString(),
      trigger_type: event.trigger_type,
      action_type: event.action_type,
      outcome: event.outcome,
      total_duration_ms: event.total_duration_ms,
      first_reply_duration_ms: event.first_reply_duration_ms,
      planner_duration_ms: event.planner_duration_ms,
      replyer_duration_ms: event.replyer_duration_ms,
      wait_duration_ms: event.wait_duration_ms,
      sent_message_count: event.sent_message_count,
    };
  });
  const data: ChatReplyPerformanceData = {
    summary: {
      total_count: events.length,
      replied_count: events.filter(
        (event) => event.outcome === "replied" || event.outcome === "sticker_sent",
      ).length,
      silent_count: events.filter((event) => event.outcome === "silent").length,
      cancelled_count: events.filter((event) => event.outcome === "cancelled").length,
      failed_count: events.filter((event) => event.outcome === "failed").length,
      average_total_duration_ms: average(totalDurations),
      p50_total_duration_ms: percentile(totalDurations, 0.5),
      p95_total_duration_ms: percentile(totalDurations, 0.95),
      average_first_reply_duration_ms: average(firstReplyDurations),
      p50_first_reply_duration_ms: percentile(firstReplyDurations, 0.5),
      p95_first_reply_duration_ms: percentile(firstReplyDurations, 0.95),
      average_planner_duration_ms: average(events.map((event) => event.planner_duration_ms)),
      average_replyer_duration_ms: average(
        events.map((event) => event.replyer_duration_ms).filter((duration) => duration > 0),
      ),
      average_wait_duration_ms: average(
        events.map((event) => event.wait_duration_ms).filter((duration) => duration > 0),
      ),
      average_platform_send_duration_ms: average(
        events.map((event) => event.platform_send_duration_ms).filter((duration) => duration > 0),
      ),
    },
    outcome_counts: [...outcomeCounts].map(([outcome, count]) => ({ outcome, count })),
    trigger_counts: [...triggerCounts].map(([trigger_type, count]) => ({
      trigger_type,
      count,
    })),
    recent_events: recentEvents,
  };

  return context.json({ code: 0, data, message: "ok" });
});
