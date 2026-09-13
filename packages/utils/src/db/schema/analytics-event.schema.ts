import mongoose, { type Document, Schema } from "mongoose";
import { getMongoConnection } from "../connect";

const ANALYTICS_EVENT_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export interface IAnalyticsEvent extends Document {
  event_name: string;
  event_data: Record<string, unknown>;
  event_time: Date;
  is_dev: boolean;
}

export const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    event_name: { type: String, required: true },
    event_data: { type: Schema.Types.Mixed, required: true },
    event_time: { type: Date, required: true },
    is_dev: { type: Boolean, required: true },
  },
  {
    collection: "analytics_event",
  },
);

AnalyticsEventSchema.index({ event_name: 1, is_dev: 1, event_time: -1 });
AnalyticsEventSchema.index(
  { event_time: 1 },
  { expireAfterSeconds: ANALYTICS_EVENT_RETENTION_SECONDS },
);

export async function getAnalyticsEventModel(): Promise<mongoose.Model<IAnalyticsEvent>> {
  const connection = await getMongoConnection();
  return (
    (connection.models.AnalyticsEvent as mongoose.Model<IAnalyticsEvent> | undefined) ??
    connection.model<IAnalyticsEvent>("AnalyticsEvent", AnalyticsEventSchema)
  );
}
