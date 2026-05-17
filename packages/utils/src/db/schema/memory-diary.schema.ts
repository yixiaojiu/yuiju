import mongoose, { type Document, Schema } from "mongoose";
import { getMongoConnection, type MongoReadSource } from "../connect";

/**
 * MongoDB 中的 Diary 条目。
 *
 * 说明：
 * - diaryDate 统一归一化到自然日零点，确保“一天一篇”约束稳定；
 * - text 保留完整日记正文，不额外拆分标题、摘要等结构；
 * - generatedAt / updatedAt 手动维护，避免引入与业务无关的 createdAt。
 */
export interface IMemoryDiary extends Document {
  subject: string;
  diaryDate: Date;
  text: string;
  generatedAt: Date;
  updatedAt: Date;
  isDev: boolean;
}

export const MemoryDiarySchema = new Schema<IMemoryDiary>(
  {
    subject: { type: String, required: true, index: true },
    diaryDate: { type: Date, required: true, index: true },
    text: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    isDev: { type: Boolean, required: true, default: false, index: true },
  },
  {
    collection: "memory_diary",
  },
);

MemoryDiarySchema.index({ subject: 1, diaryDate: 1, isDev: 1 }, { unique: true });

export async function getMemoryDiaryModel(
  source: MongoReadSource = "primary",
): Promise<mongoose.Model<IMemoryDiary>> {
  const connection = await getMongoConnection(source);
  return (
    (connection.models.MemoryDiary as mongoose.Model<IMemoryDiary> | undefined) ??
    connection.model<IMemoryDiary>("MemoryDiary", MemoryDiarySchema)
  );
}
