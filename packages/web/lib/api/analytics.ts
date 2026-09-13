import { requestApiData } from "./client";

export interface ChatReplyPerformanceSummary {
  total_count: number;
  replied_count: number;
  silent_count: number;
  cancelled_count: number;
  failed_count: number;
  average_total_duration_ms: number | null;
  p50_total_duration_ms: number | null;
  p95_total_duration_ms: number | null;
  average_first_reply_duration_ms: number | null;
  p50_first_reply_duration_ms: number | null;
  p95_first_reply_duration_ms: number | null;
  average_planner_duration_ms: number | null;
  average_replyer_duration_ms: number | null;
  average_wait_duration_ms: number | null;
  average_platform_send_duration_ms: number | null;
}

export interface ChatReplyPerformanceEvent {
  id: string;
  event_time: string;
  trigger_type: string;
  action_type: string;
  outcome: string;
  total_duration_ms: number;
  first_reply_duration_ms?: number;
  planner_duration_ms: number;
  replyer_duration_ms: number;
  wait_duration_ms: number;
  sent_message_count: number;
}

export interface ChatReplyPerformanceData {
  summary: ChatReplyPerformanceSummary;
  outcome_counts: Array<{ outcome: string; count: number }>;
  trigger_counts: Array<{ trigger_type: string; count: number }>;
  recent_events: ChatReplyPerformanceEvent[];
}

export async function fetchChatReplyPerformance(input: {
  start_time: Date;
  end_time: Date;
  is_dev: boolean;
}): Promise<ChatReplyPerformanceData> {
  const params = new URLSearchParams({
    start_time: input.start_time.toISOString(),
    end_time: input.end_time.toISOString(),
    is_dev: String(input.is_dev),
  });
  return await requestApiData<ChatReplyPerformanceData>(
    `/api/nodejs/analytics/chat-reply-performance?${params.toString()}`,
    { cache: "no-store" },
  );
}
