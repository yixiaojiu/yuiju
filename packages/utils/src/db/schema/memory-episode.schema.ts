import mongoose, { type Document, Schema } from "mongoose";
import type { MemoryEpisodeSource, MemoryEpisodeType } from "../../memory/episode";
import { getMongoConnection, type MongoReadSource } from "../connect";

/**
 * MongoDB 中的统一 Episode 文档。
 *
 * 说明：
 * - payload 使用 Mixed，允许不同事件类型保存各自的结构化明细；
 * - summaryText 作为当前检索与展示的主摘要字段；
 * - createdAt / updatedAt 由 mongoose timestamps 自动维护。
 */
export interface IMemoryEpisode extends Document {
  source: MemoryEpisodeSource;
  type: MemoryEpisodeType;
  subject: string;
  happenedAt: Date;
  /** 用于查询今日记忆时给 LLM 看的 */
  summaryText: string;
  payload: Record<string, unknown>;
  isDev: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const MemoryEpisodeSchema = new Schema<IMemoryEpisode>(
  {
    source: {
      type: String,
      enum: ["world_tick", "chat", "system"],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "behavior",
        "conversation",
        "plan_created",
        "plan_updated",
        "plan_completed",
        "plan_abandoned",
        "weather_changed",
        "system",
      ],
      required: true,
      index: true,
    },
    subject: { type: String, required: true, index: true },
    happenedAt: { type: Date, required: true, index: true },
    summaryText: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    isDev: { type: Boolean, required: true, default: false, index: true },
  },
  {
    timestamps: true,
    collection: "memory_episode",
  },
);

MemoryEpisodeSchema.index({ subject: 1, happenedAt: -1 });
MemoryEpisodeSchema.index({ subject: 1, type: 1, happenedAt: -1 });
MemoryEpisodeSchema.index({ subject: 1, isDev: 1, happenedAt: -1 });

export async function getMemoryEpisodeModel(
  source: MongoReadSource = "primary",
): Promise<mongoose.Model<IMemoryEpisode>> {
  const connection = await getMongoConnection(source);
  return (
    (connection.models.MemoryEpisode as mongoose.Model<IMemoryEpisode> | undefined) ??
    connection.model<IMemoryEpisode>("MemoryEpisode", MemoryEpisodeSchema)
  );
}
