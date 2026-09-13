import { saveAnalyticsEvent } from "../db/operations/analytics-event";
import { isDev } from "../env";

export interface AnalyticsEventInput {
  event_name: string;
  event_data: Record<string, unknown>;
}

export async function reportAnalyticsEvent(input: AnalyticsEventInput): Promise<void> {
  await saveAnalyticsEvent({
    ...input,
    event_time: new Date(),
    is_dev: isDev(),
  });
}
