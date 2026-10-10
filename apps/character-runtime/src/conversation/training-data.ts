import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { logger } from "@yuiju/shared/logger/logger";
import type { ModelMessage } from "ai";
import type { mongo } from "mongoose";
import type { ConversationScope } from "./message";

/** 原始输入和回复只追加保存，后续审核只更新 status，不延长 expire_at。 */
export type ReplyerGeneration = {
  character_id: string;
  platform: ConversationScope["platform"];
  channel_id: string;
  created_at: Date;
  expire_at: Date;
  messages: ModelMessage[];
  original_reply: string;
  /** 接口实际返回的思考正文；未返回时不保存，不直接作为训练目标。 */
  original_reasoning?: string;
  model: string;
  status: "pending" | "approved" | "excluded";
};

/** MongoDB 独立生成 _id；完整输入随样本保存，不依赖原始记录在过期后仍可读取。 */
export type ReplyerTrainingSample = {
  character_id: string;
  platform: ConversationScope["platform"];
  channel_id: string;
  generation_id: mongo.ObjectId;
  generated_at: Date;
  confirmed_at: Date;
  messages: ModelMessage[];
  original_reply: string;
  final_reply: string;
  model: string;
};

let collectionTask: Promise<mongo.Collection<ReplyerGeneration>> | undefined;

/** 首次采集时建立两张表及索引；训练样本的确认写入在标注功能中实现。 */
async function initializeCollections(): Promise<mongo.Collection<ReplyerGeneration>> {
  const database = await getMongoDatabase();
  const generations = database.collection<ReplyerGeneration>(
    mongoCollectionName("replyer_generations"),
  );
  const samples = database.collection<ReplyerTrainingSample>(
    mongoCollectionName("replyer_training_samples"),
  );
  await Promise.all([
    generations.createIndexes([
      { key: { character_id: 1, status: 1, created_at: -1 } },
      { key: { character_id: 1, channel_id: 1, created_at: -1 } },
      { key: { expire_at: 1 }, expireAfterSeconds: 0 },
    ]),
    samples.createIndexes([
      { key: { generation_id: 1 }, unique: true },
      { key: { character_id: 1, generated_at: -1 } },
    ]),
  ]);
  return generations;
}

/**
 * 由 Replyer 在开启采集且生成成功后直接调用，不等待写入完成。
 * 写入失败只记错误；不重试，不影响回复。进程退出可能丢失尚未完成的采集。
 */
export async function collectReplyerGeneration(
  scope: ConversationScope,
  messages: ModelMessage[],
  originalReply: string,
  model: string,
  originalReasoning: string | undefined,
): Promise<void> {
  try {
    const createdAt = new Date();
    const generation: ReplyerGeneration = {
      character_id: scope.characterId,
      platform: scope.platform,
      channel_id: scope.channelId,
      created_at: createdAt,
      expire_at: new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000),
      messages: structuredClone(messages),
      original_reply: originalReply,
      ...(originalReasoning !== undefined ? { original_reasoning: originalReasoning } : {}),
      model,
      status: "pending",
    };
    collectionTask ??= initializeCollections();
    let collection: mongo.Collection<ReplyerGeneration>;
    try {
      collection = await collectionTask;
    } catch (error) {
      collectionTask = undefined;
      throw error;
    }
    await collection.insertOne(generation);
  } catch (error) {
    logger.error("Replyer 训练数据采集失败", { error });
  }
}
