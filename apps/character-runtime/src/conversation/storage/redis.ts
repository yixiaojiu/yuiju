import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import { modelMessageSchema } from "ai";
import { z } from "zod";
import { conversationAgentEventSchema } from "../../communication";
import type { ContextSummary, ContextUnit } from "../context";
import { type ConversationInputEvent, stickerAnnotationEventSchema } from "../events";
import type { ConversationWait } from "../loop";
import type { ConversationMessage, ConversationScope } from "../message";

/** 实际交流按发生时间保留 30 天，延迟归档不延长保留时间。 */
export const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 角色级内部输入；consumed 表示已注入唯一 Planner，不代表已执行或对外发送。 */
export type PlannerAgentEvent = ConversationInputEvent & {
  /** 关联来源群（例如主 loop 针对某群交流的反馈）；无固定来源时省略。 */
  channelId?: string;
  consumed: boolean;
};

/** 单一 Planner 的业务进度与注意力归属；与定时器、Promise 等进程资源分开保存。 */
export type PlannerRuntime = {
  focusedChannelId: string | null;
  /** 切焦后尚未向 Planner 宣告切换边界与准备未读积压时为 true。 */
  focusAnnouncementPending?: boolean;
  /** 发送前先提交标记，重启后不重放可能已产生外部副作用的轮次。 */
  currentRound?: { channelId: string; throughSequence: number; sendAttempted: boolean };
  waiting?: ConversationWait;
  agentEvents?: PlannerAgentEvent[];
};

/** 单群自己的收发进度、沉默退避和暂停状态；不持有 Planner 上下文。 */
export type ChannelRuntime = {
  sequence: number;
  processedThrough: number;
  /** 已注入 Planner 的外部输入边界，失败后不重复注入。 */
  plannerInputThrough: number;
  failedThroughSequence?: number;
  silentRounds: number;
  silenceCooldownUntil: number;
  /** 暂停期消息只作为背景；少于 30 条保留原文，否则分批摘要，恢复后不补跑回复。 */
  paused?: { summary: string; coveredThrough: number };
  /** 后台未读触发已通知当前焦点 Planner 的最新序号，避免因同一批旧消息重复唤醒。 */
  notifiedThrough?: number;
};

/** 角色级 Planner Redis Hash 的两个字段；调用方只提交本次变更涉及的字段。 */
export type PlannerState = {
  runtime: PlannerRuntime;
  planner: { history: ContextUnit[]; summary: Readonly<ContextSummary> };
};

/** 单群 Redis Hash 的三个字段；调用方只提交本次变更涉及的字段。 */
export type ChannelState = {
  runtime: ChannelRuntime;
  history: ConversationMessage[];
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

const plannerStateSchema: z.ZodType<PlannerState> = z.strictObject({
  runtime: z.strictObject({
    focusedChannelId: z.string().min(1).nullable(),
    focusAnnouncementPending: z.boolean().optional(),
    currentRound: z
      .strictObject({
        channelId: z.string().min(1),
        throughSequence: sequenceSchema,
        sendAttempted: z.boolean(),
      })
      .optional(),
    waiting: z.strictObject({ startedAt: z.number(), until: z.number() }).optional(),
    agentEvents: z
      .array(
        z.discriminatedUnion("type", [
          conversationAgentEventSchema.options[0].extend({
            channelId: z.string().min(1).optional(),
            consumed: z.boolean(),
          }),
          conversationAgentEventSchema.options[1].extend({
            channelId: z.string().min(1).optional(),
            consumed: z.boolean(),
          }),
          stickerAnnotationEventSchema.extend({
            channelId: z.string().min(1).optional(),
            consumed: z.boolean(),
          }),
        ]),
      )
      .optional(),
  }),
  planner: z.strictObject({
    history: z.array(
      z.strictObject({
        sequence: sequenceSchema.positive(),
        messages: z.array(modelMessageSchema),
      }),
    ),
    summary: summarySchema,
  }),
});

const channelStateSchema: z.ZodType<ChannelState> = z.strictObject({
  runtime: z.strictObject({
    sequence: sequenceSchema,
    processedThrough: sequenceSchema,
    plannerInputThrough: sequenceSchema,
    failedThroughSequence: sequenceSchema.optional(),
    silentRounds: sequenceSchema,
    silenceCooldownUntil: z.number(),
    paused: z.strictObject({ summary: z.string(), coveredThrough: sequenceSchema }).optional(),
    notifiedThrough: sequenceSchema.optional(),
  }),
  history: z.array(messageSchema),
  replyerSummary: summarySchema,
});

function plannerKey(characterId: string, platform: ConversationScope["platform"]): string {
  return `${redisKeyPrefix()}conversation:${[characterId, platform].map(encodeURIComponent).join(":")}:planner`;
}

function channelKey(scope: ConversationScope): string {
  return `${redisKeyPrefix()}conversation:${[scope.characterId, scope.platform, scope.channelId].map(encodeURIComponent).join(":")}`;
}

export async function loadPlannerState(
  characterId: string,
  platform: ConversationScope["platform"],
): Promise<PlannerState | null> {
  const redis = await getRedis();
  const fields = await redis.hgetall(plannerKey(characterId, platform));
  if (!Object.keys(fields).length) {
    return null;
  }
  return plannerStateSchema.parse(
    Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, JSON.parse(value)])),
  );
}

/** 调用方必须在写入队列内构造快照并等待提交。 */
export async function savePlannerState(
  characterId: string,
  platform: ConversationScope["platform"],
  changes: Partial<PlannerState>,
): Promise<void> {
  const entries = Object.entries(changes);
  if (!entries.length) {
    return;
  }
  const redis = await getRedis();
  await redis.hset(
    plannerKey(characterId, platform),
    Object.fromEntries(entries.map(([name, value]) => [name, JSON.stringify(value)])),
  );
}

export async function loadChannelState(scope: ConversationScope): Promise<ChannelState | null> {
  const redis = await getRedis();
  const fields = await redis.hgetall(`${channelKey(scope)}:state`);
  if (!Object.keys(fields).length) {
    return null;
  }
  return channelStateSchema.parse(
    Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, JSON.parse(value)])),
  );
}

/**
 * 调用方必须在会话写入队列内构造快照并等待提交。
 * 收发事件与待归档记录同事务写入；这里不决定消费输入、等待或裁剪规则。
 */
export async function saveChannelState(
  scope: ConversationScope,
  changes: Partial<ChannelState>,
  events: ConversationMessage[] = [],
): Promise<void> {
  // 在提交前拒绝不符合消息契约的事件，避免坏记录进入会话及归档缓冲。
  for (const event of events) {
    messageSchema.parse(event);
  }
  const redis = await getRedis();
  const key = channelKey(scope);
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
  if (!results) {
    throw new Error("会话状态事务未执行");
  }
  for (const [error] of results) {
    if (error) {
      throw error;
    }
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
  const key = `${channelKey(scope)}:archive`;
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
