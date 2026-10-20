import { mongoCollectionName, redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import { modelMessageSchema } from "ai";
import type { mongo } from "mongoose";
import { z } from "zod";
import { type ConversationAgentEvent, conversationAgentEventSchema } from "../communication";
import type { ContextSummary, ContextUnit } from "./context";
import type { ConversationWait } from "./loop";
import type { ConversationMessage, ConversationScope } from "./message";

/** 实际交流按发生时间保留 30 天，延迟归档不延长保留时间。 */
export const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 会话自己的业务进度；与定时器、Promise 等进程资源分开保存。 */
export type ConversationRuntime = {
  sequence: number;
  processedThrough: number;
  /** 已注入 Planner 的外部输入边界，失败后不重复注入。 */
  plannerInputThrough: number;
  /** 发送前先提交标记，重启后不重放可能已产生外部副作用的轮次。 */
  currentRound?: { throughSequence: number; sendAttempted: boolean };
  waiting?: ConversationWait;
  failedThroughSequence?: number;
  silentRounds: number;
  silenceCooldownUntil: number;
  /** 暂停期消息只作为背景；少于 30 条保留原文，否则分批摘要，恢复后不补跑回复。 */
  paused?: { summary: string; coveredThrough: number };
  /** 主 loop 的输入；consumed 表示已注入 Planner 上下文，不代表已对外发送。 */
  agentEvents?: (ConversationAgentEvent & { consumed: boolean })[];
};

/** Redis Hash 的四个字段；调用方只提交本次变更涉及的字段。 */
export type ConversationState = {
  runtime: ConversationRuntime;
  history: ConversationMessage[];
  planner: { history: ContextUnit[]; summary: Readonly<ContextSummary> };
  replyerSummary: Readonly<ContextSummary>;
};

const sequenceSchema = z.number().int().nonnegative();
const summarySchema = z.strictObject({ text: z.string(), coveredThrough: sequenceSchema });
const eventFields = {
  sequence: sequenceSchema.positive(),
  senderId: z.string(),
  senderName: z.string(),
  timestamp: z.number(),
  isSelf: z.boolean(),
};
/** 在持久化读取边界校验，不将损坏或缺字段的状态补成新会话。 */
const messageSchema: z.ZodType<ConversationMessage> = z.discriminatedUnion("kind", [
  z.strictObject({
    ...eventFields,
    kind: z.literal("message"),
    id: z.string(),
    content: z.string(),
    quote: z
      .strictObject({
        id: z.string(),
        content: z.string().optional(),
        senderId: z.string().optional(),
        senderName: z.string().optional(),
      })
      .optional(),
    mentionedSenderId: z.string().optional(),
  }),
  z.strictObject({ ...eventFields, kind: z.literal("poke"), targetSenderId: z.string() }),
  z.strictObject({
    ...eventFields,
    kind: z.literal("recall"),
    recalledMessageId: z.string(),
    operatorId: z.string(),
  }),
]);
const stateSchema: z.ZodType<ConversationState> = z.strictObject({
  runtime: z.strictObject({
    sequence: sequenceSchema,
    processedThrough: sequenceSchema,
    plannerInputThrough: sequenceSchema,
    currentRound: z
      .strictObject({
        throughSequence: sequenceSchema,
        sendAttempted: z.boolean(),
      })
      .optional(),
    waiting: z.strictObject({ startedAt: z.number(), until: z.number() }).optional(),
    failedThroughSequence: sequenceSchema.optional(),
    silentRounds: sequenceSchema,
    silenceCooldownUntil: z.number(),
    paused: z.strictObject({ summary: z.string(), coveredThrough: sequenceSchema }).optional(),
    agentEvents: z
      .array(
        z.discriminatedUnion("type", [
          conversationAgentEventSchema.options[0].extend({ consumed: z.boolean() }),
          conversationAgentEventSchema.options[1].extend({ consumed: z.boolean() }),
        ]),
      )
      .optional(),
  }),
  history: z.array(messageSchema),
  planner: z.strictObject({
    history: z.array(
      z.strictObject({
        sequence: sequenceSchema.positive(),
        messages: z.array(modelMessageSchema),
      }),
    ),
    summary: summarySchema,
  }),
  replyerSummary: summarySchema,
});

function conversationKey(scope: ConversationScope): string {
  return `${redisKeyPrefix()}conversation:${[scope.characterId, scope.platform, scope.channelId].map(encodeURIComponent).join(":")}`;
}

export async function loadConversationState(
  scope: ConversationScope,
): Promise<ConversationState | null> {
  const redis = await getRedis();
  const fields = await redis.hgetall(`${conversationKey(scope)}:state`);
  if (!Object.keys(fields).length) return null;
  return stateSchema.parse(
    Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, JSON.parse(value)])),
  );
}

/**
 * 调用方必须在会话写入队列内构造快照并等待提交。
 * 收发事件与待归档记录同事务写入；这里不决定消费输入、等待或裁剪规则。
 */
export async function saveConversationState(
  scope: ConversationScope,
  changes: Partial<ConversationState>,
  events: ConversationMessage[] = [],
): Promise<void> {
  // 在提交前拒绝不符合消息契约的事件，避免坏记录进入会话及归档缓冲。
  for (const event of events) {
    messageSchema.parse(event);
  }
  const redis = await getRedis();
  const key = conversationKey(scope);
  const transaction = redis
    .multi()
    .hset(
      `${key}:state`,
      Object.fromEntries(
        Object.entries(changes).map(([name, value]) => [name, JSON.stringify(value)]),
      ),
    );
  if (events.length) {
    transaction.hset(
      `${key}:archive`,
      Object.fromEntries(
        events.map((message) => [String(message.sequence), JSON.stringify(message)]),
      ),
    );
    // 整个归档缓冲在最后一次收发后保留 30 天；活跃会话仍按消息时间逐条清理。
    transaction.pexpire(`${key}:archive`, MESSAGE_RETENTION_MS);
  }
  const results = await transaction.exec();
  if (!results) throw new Error("会话状态事务未执行");
  for (const [error] of results) {
    if (error) throw error;
  }
}

/** 增量发现当前角色在当前环境的积压，包含已经退出白名单的会话。 */
export async function* pendingArchiveScopes(
  characterId: string,
): AsyncGenerator<ConversationScope> {
  const redis = await getRedis();
  const prefix = `${redisKeyPrefix()}conversation:${encodeURIComponent(characterId)}:`;
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      // encodeURIComponent 会保留 *，在 Redis MATCH 中需要按字面量匹配角色 ID。
      `${prefix.replaceAll("*", "\\*")}*:*:archive`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    for (const key of keys) {
      const [platform, channelId] = key
        .slice(prefix.length, -":archive".length)
        .split(":")
        .map(decodeURIComponent);
      yield z
        .strictObject({
          characterId: z.string(),
          platform: z.literal("onebot"),
          channelId: z.string(),
        })
        .parse({ characterId, platform, channelId });
    }
  } while (cursor !== "0");
}

/** 取走本页后再解析和归档；失败不重新入队，新到消息不在删除范围内。 */
export async function takePendingArchive(scope: ConversationScope, cursor: string) {
  const redis = await getRedis();
  const key = `${conversationKey(scope)}:archive`;
  const [nextCursor, fields] = await redis.hscan(key, cursor, "COUNT", 100);
  const sequences = fields.filter((_, index) => index % 2 === 0);
  if (sequences.length) {
    await redis.hdel(key, ...sequences);
  }
  const messages: ConversationMessage[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    try {
      const message = messageSchema.parse(JSON.parse(fields[index + 1]));
      if (String(message.sequence) !== fields[index]) {
        throw new Error("待归档序号与正文不一致");
      }
      messages.push(message);
    } catch (error) {
      logger.error("聊天归档记录不符合契约，已丢弃", { error });
    }
  }
  return { cursor: nextCursor, messages };
}

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
