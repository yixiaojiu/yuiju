export interface ActiveChatTask {
  controller: AbortController;
  /**
   * 直接复用触发本次回复生成的消息 `message_id`，用于识别当前会话最新的一次回复生成请求。
   *
   * 说明：
   * - 仅依赖 abort() 不足以完全避免竞态，旧请求可能在被取消前后恰好返回；
   * - 因此在生成完成和真正发送回复前，都要再次校验 requestId 是否仍然是该会话最新值；
   * - 只要 requestId 已经过期，就把这次结果视为失效，禁止继续发送消息。
   */
  requestId: string;
}

export type ChatResult =
  | {
      status: "completed";
      requestId: string;
      shouldReply: boolean;
      reply: string;
      noReplyReason: string;
    }
  | {
      status: "failed";
    }
  | {
      status: "cancelled";
    };

export interface SessionHistoryContext {
  /**
   * 当前会话的滚动摘要。
   *
   * 说明：
   * - 摘要会单独返回给上层，由 prompt 构建器决定如何注入；
   * - 不再把摘要伪装成 JSON 历史项，避免和真实消息结构混在一起。
   */
  summary?: string;
  historyJson: string;
}

export interface ChatHistoryOptions {
  limit?: number;
}

export interface ChatMessageInput<TMessage> {
  sessionId: string;
  sessionLabel: string;
  message: TMessage;
}

export interface ChatMessageRecallInput {
  sessionId: string;
  messageId: string;
  timestamp: number;
}

export interface ChatSessionManagerOptions {
  /**
   * 最近原始会话历史最多保留多少条消息。
   *
   * 说明：
   * - 这部分历史会进入 `getHistoryJson()`，供回复判断和回复生成读取；
   * - 超过上限后只保留最新的 N 条；
   * - 不影响滚动摘要和 episode 窗口的切分边界。
   */
  conversationLimit: number;
  /**
   * 最近原始会话历史最多保留多长时间范围内的消息。
   *
   * 说明：
   * - 早于该时间窗口的消息会在 trim 时被丢弃；
   * - 它和 `conversationLimit` 一起决定 `getHistoryJson()` 能看到的原始上下文；
   * - 不影响滚动摘要和 episode 窗口的切分边界。
   */
  conversationTtlMs: number;
  /**
   * 滚动摘要块累计达到该消息数后立即刷新。
   */
  summaryFlushMessageCount: number;
  /**
   * 滚动摘要块静默多久后，在下一条消息到来时先封口刷新旧块。
   */
  summaryFlushIdleMs: number;
  /**
   * 单个 episode 最多允许累计多少条消息。
   *
   * 说明：
   * - 达到上限后会立即归档当前窗口；
   * - 触发上限的那条消息仍归入当前窗口；
   * - 不影响滚动摘要刷新节奏。
   */
  episodeMessageCountLimit: number;
}

/**
 * 自上次摘要刷新后累计的增量消息块。
 *
 * 说明：
 * - 只承载“下一次要压进滚动摘要”的新增消息；
 * - 达到条数阈值或静默阈值后会被封口并刷新，不参与 episode 切段。
 */
export interface RollingSummaryChunkState<TMessage> {
  sessionLabel: string;
  chunkStartMs: number;
  lastTsMs: number;
  messages: TMessage[];
}

/**
 * 当前正在进行中的自然对话段。
 *
 * 说明：
 * - 只用于 memory episode 归档；
 * - 只按消息数量上限或显式归档切窗，不受摘要刷新节奏影响。
 */
export interface EpisodeWindowState<TMessage> {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: TMessage[];
}

export interface ChatSessionManagerInput {
  options: ChatSessionManagerOptions;
  sceneLabel: "group" | "private";
}

export interface ConversationState<TMessage> {
  messages: TMessage[];
  replyWindowTimer?: ReturnType<typeof setTimeout>;
}
