import { getAnalyticsEventModel, type IAnalyticsEvent } from "../schema/analytics-event.schema";

export interface AnalyticsEventWriteInput {
  event_name: string;
  event_data: Record<string, unknown>;
  event_time: Date;
  is_dev: boolean;
}

export async function saveAnalyticsEvent(
  input: AnalyticsEventWriteInput,
): Promise<IAnalyticsEvent> {
  const model = await getAnalyticsEventModel();
  return await model.create(input);
}

export async function findAnalyticsEvents(input: {
  event_name: string;
  start_time: Date;
  end_time: Date;
  is_dev: boolean;
}): Promise<IAnalyticsEvent[]> {
  const model = await getAnalyticsEventModel();
  return await model
    .find({
      event_name: input.event_name,
      event_time: { $gte: input.start_time, $lt: input.end_time },
      is_dev: input.is_dev,
    })
    .sort({ event_time: -1 })
    .exec();
}
