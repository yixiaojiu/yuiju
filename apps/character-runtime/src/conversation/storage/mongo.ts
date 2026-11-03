import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import type { mongo } from "mongoose";
import type { ConversationMessage, ConversationScope } from "../message";
import { MESSAGE_RETENTION_MS } from "./redis";

/** 每日整理只冻结原始消息的定位信息，不复制正文。 */
export type ArchivedConversationMessage = ConversationScope & ConversationMessage;
type MessageDocument = ArchivedConversationMessage & { expireAt: Date };
let collectionTask: Promise<mongo.Collection<MessageDocument>> | undefined;

/** 索引只由聊天存储定义；本批失败不重试，后续新批次可以重新初始化。 */
async function messageCollection(): Promise<mongo.Collection<MessageDocument>> {
  collectionTask ??= initializeMessageCollection();
  try {
    return await collectionTask;
  } catch (error) {
    collectionTask = undefined;
    throw error;
  }
}

async function initializeMessageCollection() {
  const database = await getMongoDatabase();
  const collection = database.collection<MessageDocument>(
    mongoCollectionName("conversation_messages"),
  );
  await collection.createIndexes([
    { key: { characterId: 1, platform: 1, channelId: 1, sequence: 1 }, unique: true },
    {
      key: { characterId: 1, platform: 1, channelId: 1, id: 1 },
      unique: true,
      partialFilterExpression: { kind: "message" },
    },
    { key: { characterId: 1, platform: 1, channelId: 1, timestamp: 1, sequence: 1 } },
    { key: { characterId: 1, timestamp: 1 } },
    { key: { expireAt: 1 }, expireAfterSeconds: 0 },
  ]);
  return collection;
}

/** 只追加事实；每批仅写入一次，部分失败也不重新投递。 */
export async function archiveConversationMessages(
  scope: ConversationScope,
  messages: ConversationMessage[],
): Promise<void> {
  const collection = await messageCollection();
  await collection.bulkWrite(
    messages.map((message) => ({
      updateOne: {
        filter: { ...scope, sequence: message.sequence },
        update: {
          $setOnInsert: {
            ...scope,
            ...message,
            expireAt: new Date(message.timestamp + MESSAGE_RETENTION_MS),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** 历史浏览及记忆整理使用；正常对话和恢复不调用 MongoDB 查询。 */
export async function queryConversationMessages(
  scope: ConversationScope,
  range: { after: number; through?: number; limit: number } | { messageId: string },
): Promise<ConversationMessage[]> {
  const collection = await messageCollection();
  const filter =
    "messageId" in range
      ? { ...scope, kind: "message" as const, id: range.messageId }
      : {
          ...scope,
          sequence: {
            $gt: range.after,
            ...(range.through !== undefined && { $lte: range.through }),
          },
        };
  const documents = await collection
    .find(filter)
    .sort({ sequence: 1 })
    .limit("messageId" in range ? 1 : range.limit)
    .toArray();
  return documents.map(
    ({ _id, characterId, platform, channelId, expireAt, ...message }) => message,
  );
}

/** 按消息发生时间读取半开区间；截止时间推进后，迟到归档的旧消息不再补录。 */
export async function queryMemoryMessages(
  characterId: string,
  from: number,
  through: number,
): Promise<ArchivedConversationMessage[]> {
  const documents = await (await messageCollection())
    .find({ characterId, timestamp: { $gte: from, $lt: through } })
    .sort({ timestamp: 1, platform: 1, channelId: 1, sequence: 1 })
    .toArray();
  return documents.map(({ _id, expireAt, ...message }) => message);
}
