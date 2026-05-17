import {
  buildMessageSummaryPrompt,
  emitMemoryEpisode,
  getTimeWithWeekday,
  isDev,
  smallModel,
  summarizeConversationMessages,
} from "@yuiju/utils";
import { generateText } from "ai";
import dayjs from "dayjs";
import {
  getProtocolMessageSenderName,
  type HistoryJsonItem,
  projectHistoryMessageContent,
  type StoredGroupMessage,
  type StoredPrivateMessage,
  type StoredProtocolMessage,
} from "@/utils/message";
import { buildConversationEpisode } from "../memory/episode-builder";
import {
  writePersonMemoryUpdatesForGroupChatWindow,
  writePersonMemoryUpdatesForPrivateChatWindow,
} from "../memory/person-memory";

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

export interface ChatMessageInput<TMessage> {
  sessionId: string;
  sessionLabel: string;
  message: TMessage;
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
   * 自然对话段静默多久后视为 episode 结束。
   */
  episodeIdleMs: number;
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
 * LLMManager 依赖的会话管理抽象契约。
 *
 * 说明：
 * - 这里只定义对外能力，不暴露内部摘要/窗口实现细节；
 * - 群聊和私聊在上层仍保留独立入口，但可复用底层通用实现。
 */
export abstract class AbstractChatSessionManager<TMessage> {
  abstract recordMessage(input: ChatMessageInput<TMessage>): void;

  abstract getHistoryJson(sessionId: string, limit?: number): Promise<SessionHistoryContext>;

  abstract flushUserWindow(sessionId: string): Promise<void>;
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
 * - 只按较长静默时间或消息数量上限切窗，不受摘要刷新节奏影响。
 */
export interface EpisodeWindowState<TMessage> {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: TMessage[];
}

interface BaseChatSessionManagerInput<TMessage extends StoredProtocolMessage> {
  options: ChatSessionManagerOptions;
  sceneLabel: "group" | "private";
}

/**
 * 群聊/私聊共享的会话核心实现。
 *
 * 说明：
 * - 最近原始消息、滚动摘要块、episode 窗口分开维护，避免三个职责共用一个阈值；
 * - 上层仍通过 Group/Private 两个薄包装类接入，保留业务语义边界。
 */
export class BaseChatSessionManager<
  TMessage extends StoredProtocolMessage,
> extends AbstractChatSessionManager<TMessage> {
  private conversationBySessionId = new Map<string, TMessage[]>();
  private summaryChunkBySessionId = new Map<string, RollingSummaryChunkState<TMessage>>();
  private episodeStateBySessionId = new Map<string, EpisodeWindowState<TMessage>>();
  private summaryBySessionId = new Map<string, string>();
  private pendingSummaryBySessionId = new Map<string, Promise<void>>();
  private conversationLimit: number;
  private conversationTtlMs: number;
  private summaryFlushMessageCount: number;
  private summaryFlushIdleMs: number;
  private episodeIdleMs: number;
  private episodeMessageCountLimit: number;
  private isDev: boolean;
  private sceneLabel: "group" | "private";

  constructor(input: BaseChatSessionManagerInput<TMessage>) {
    super();
    const { options, sceneLabel } = input;

    this.conversationLimit = options.conversationLimit;
    this.conversationTtlMs = options.conversationTtlMs;
    this.summaryFlushMessageCount = options.summaryFlushMessageCount;
    this.summaryFlushIdleMs = options.summaryFlushIdleMs;
    this.episodeIdleMs = options.episodeIdleMs;
    this.episodeMessageCountLimit = options.episodeMessageCountLimit;
    this.sceneLabel = sceneLabel;
    this.isDev = isDev();
  }

  recordMessage(input: ChatMessageInput<TMessage>) {
    this.appendConversationEntry(input);
    this.appendSummaryChunkMessage(input);
    this.appendEpisodeMessage(input);
  }

  async getHistoryJson(sessionId: string, limit?: number): Promise<SessionHistoryContext> {
    await this.pendingSummaryBySessionId.get(sessionId);

    const list = this.conversationBySessionId.get(sessionId) ?? [];
    const trimmedMessages = this.trimConversation(list);
    if (trimmedMessages.length !== list.length) {
      this.conversationBySessionId.set(sessionId, trimmedMessages);
    }

    const summary = this.summaryBySessionId.get(sessionId);
    const promptMessages = limit
      ? trimmedMessages.slice(Math.max(trimmedMessages.length - limit, 0))
      : trimmedMessages;
    const historyItems = this.buildHistoryItems(promptMessages);

    return {
      summary,
      historyJson: JSON.stringify(historyItems, null, 2),
    };
  }

  async flushUserWindow(sessionId: string) {
    const summaryChunk = this.summaryChunkBySessionId.get(sessionId);
    if (summaryChunk) {
      this.summaryChunkBySessionId.delete(sessionId);
      await this.enqueueSummaryRefresh(sessionId, summaryChunk);
    }

    const episodeState = this.episodeStateBySessionId.get(sessionId);
    if (!episodeState) {
      return;
    }

    this.episodeStateBySessionId.delete(sessionId);
    await this.finalizeEpisodeWindow(episodeState);
  }

  private appendConversationEntry(input: ChatMessageInput<TMessage>) {
    const list = this.conversationBySessionId.get(input.sessionId) ?? [];
    list.push(input.message);
    this.conversationBySessionId.set(input.sessionId, this.trimConversation(list));
  }

  /**
   * 维护摘要增量块。
   *
   * 说明：
   * - 静默超过阈值时，旧块会先异步压进滚动摘要，再开启新块；
   * - 达到条数阈值时立即封口刷新，避免活跃会话里的旧消息长期脱离摘要。
   */
  private appendSummaryChunkMessage(input: ChatMessageInput<TMessage>) {
    const messageTimeMs = input.message.time * 1000;
    const currentState = this.summaryChunkBySessionId.get(input.sessionId);

    if (!currentState) {
      this.summaryChunkBySessionId.set(
        input.sessionId,
        this.createSummaryChunkState(input, messageTimeMs),
      );
      return;
    }

    const gapMs = messageTimeMs - currentState.lastTsMs;
    if (gapMs > this.summaryFlushIdleMs) {
      this.summaryChunkBySessionId.delete(input.sessionId);
      void this.enqueueSummaryRefresh(input.sessionId, currentState);
      this.summaryChunkBySessionId.set(
        input.sessionId,
        this.createSummaryChunkState(input, messageTimeMs),
      );
      return;
    }

    currentState.lastTsMs = messageTimeMs;
    currentState.messages.push(input.message);

    if (currentState.messages.length < this.summaryFlushMessageCount) {
      return;
    }

    this.summaryChunkBySessionId.delete(input.sessionId);
    void this.enqueueSummaryRefresh(input.sessionId, currentState);
  }

  /**
   * 维护 memory episode 的自然对话段。
   *
   * 说明：
   * - 静默超过阈值时，旧窗口先归档，再用当前消息开启新窗口；
   * - 达到消息数上限时，当前窗口立即归档；
   * - 摘要刷新不会影响 episode 的窗口边界。
   */
  private appendEpisodeMessage(input: ChatMessageInput<TMessage>) {
    const messageTimeMs = input.message.time * 1000;
    const currentState = this.episodeStateBySessionId.get(input.sessionId);

    if (!currentState) {
      this.episodeStateBySessionId.set(
        input.sessionId,
        this.createEpisodeWindowState(input, messageTimeMs),
      );
      return;
    }

    const gapMs = messageTimeMs - currentState.lastTsMs;
    if (gapMs > this.episodeIdleMs) {
      this.episodeStateBySessionId.delete(input.sessionId);
      void this.finalizeEpisodeWindow(currentState);
      this.episodeStateBySessionId.set(
        input.sessionId,
        this.createEpisodeWindowState(input, messageTimeMs),
      );
      return;
    }

    currentState.lastTsMs = messageTimeMs;
    currentState.messages.push(input.message);

    if (currentState.messages.length < this.episodeMessageCountLimit) {
      return;
    }

    this.episodeStateBySessionId.delete(input.sessionId);
    void this.finalizeEpisodeWindow(currentState);
  }

  private createSummaryChunkState(
    input: ChatMessageInput<TMessage>,
    messageTimeMs: number,
  ): RollingSummaryChunkState<TMessage> {
    return {
      sessionLabel: input.sessionLabel,
      chunkStartMs: messageTimeMs,
      lastTsMs: messageTimeMs,
      messages: [input.message],
    };
  }

  private createEpisodeWindowState(
    input: ChatMessageInput<TMessage>,
    messageTimeMs: number,
  ): EpisodeWindowState<TMessage> {
    return {
      sessionLabel: input.sessionLabel,
      windowStartMs: messageTimeMs,
      lastTsMs: messageTimeMs,
      messages: [input.message],
    };
  }

  private async finalizeEpisodeWindow(state: EpisodeWindowState<TMessage>) {
    try {
      await this.writeChatWindowEpisode({
        sessionLabel: state.sessionLabel,
        state,
        isDev: this.isDev,
      });
    } catch (error) {
      console.error(`Failed to write ${this.sceneLabel} chat window episode:`, error);
    }
  }

  private enqueueSummaryRefresh(
    sessionId: string,
    state: RollingSummaryChunkState<TMessage>,
  ): Promise<void> {
    const previousTask = this.pendingSummaryBySessionId.get(sessionId) ?? Promise.resolve();

    const task = previousTask
      .catch(() => {})
      .then(async () => {
        try {
          const previousSummary = this.summaryBySessionId.get(sessionId);
          const nextSummary = await this.generateSessionSummary({
            sessionLabel: state.sessionLabel,
            previousSummary,
            messages: state.messages,
          });

          if (!nextSummary) {
            this.summaryBySessionId.delete(sessionId);
            return;
          }

          this.summaryBySessionId.set(sessionId, nextSummary);
        } catch (error) {
          console.error(`Failed to update ${this.sceneLabel} chat session summary:`, error);
        }
      })
      .finally(() => {
        if (this.pendingSummaryBySessionId.get(sessionId) === task) {
          this.pendingSummaryBySessionId.delete(sessionId);
        }
      });

    this.pendingSummaryBySessionId.set(sessionId, task);
    return task;
  }

  /**
   * 群聊与私聊都复用同一份摘要格式化逻辑，避免 prompt 结构分叉。
   */
  private async generateSessionSummary(input: {
    sessionLabel: string;
    previousSummary?: string;
    messages: TMessage[];
  }): Promise<string | null> {
    const transcript = JSON.stringify(this.buildHistoryItems(input.messages), null, 2);

    const result = await generateText({
      model: smallModel,
      prompt: buildMessageSummaryPrompt({
        sessionLabel: input.sessionLabel,
        previousSummary: input.previousSummary,
        transcript,
      }),
    });

    const summaryText = result.text.trim();
    if (!summaryText || summaryText === "无") {
      return null;
    }

    return summaryText;
  }

  /**
   * 将内部 episode 窗口投影为 memory episode。
   *
   * 说明：
   * - episode payload 继续保留统一展示结构；
   * - 摘要刷新和 episode 归档分离后，这里只消费自然对话段状态。
   */
  private async writeChatWindowEpisode(input: {
    sessionLabel: string;
    state: EpisodeWindowState<TMessage>;
    isDev: boolean;
  }) {
    let summaryText: string | null = null;
    try {
      summaryText = await summarizeConversationMessages({
        scene: this.sceneLabel,
        sessionLabel: input.sessionLabel,
        historyJson: JSON.stringify(this.buildHistoryItems(input.state.messages), null, 2),
      });
    } catch (error) {
      console.error(`Failed to summarize ${this.sceneLabel} chat window episode:`, error);
    }

    const episode = buildConversationEpisode({
      sessionLabel: input.sessionLabel,
      state: input.state,
      isDev: input.isDev,
      summaryText: summaryText ?? undefined,
    });

    await Promise.all([
      emitMemoryEpisode(episode),
      this.writePersonMemoryUpdatesForChatWindow(input.state).catch((error) => {
        console.error(`Failed to update ${this.sceneLabel} person memory:`, error);
      }),
    ]);
  }

  private async writePersonMemoryUpdatesForChatWindow(state: EpisodeWindowState<TMessage>) {
    if (this.sceneLabel === "private") {
      await writePersonMemoryUpdatesForPrivateChatWindow(
        state as EpisodeWindowState<StoredPrivateMessage>,
      );
      return;
    }

    await writePersonMemoryUpdatesForGroupChatWindow(
      state as EpisodeWindowState<StoredGroupMessage>,
    );
  }

  /**
   * 构建供摘要与 history JSON 复用的结构化历史项。
   *
   * 说明：
   * - 这里只做消息投影，不混入 trim、summary 合并等会话控制逻辑；
   * - 摘要与 prompt 使用同一投影，避免两边结构漂移。
   */
  private buildHistoryItems(messages: TMessage[]): HistoryJsonItem[] {
    return messages.map((message) => ({
      speaker: getProtocolMessageSenderName(message),
      time: getTimeWithWeekday(dayjs.unix(message.time)),
      content: projectHistoryMessageContent(message.message),
    }));
  }

  private trimConversation(list: TMessage[]): TMessage[] {
    const cutoffMs = Date.now() - this.conversationTtlMs;
    const filtered = list.filter((message) => message.time * 1000 >= cutoffMs);

    return filtered.length > this.conversationLimit
      ? filtered.slice(filtered.length - this.conversationLimit)
      : filtered;
  }
}

/**
 * 群聊会话管理器。
 *
 * 说明：
 * - 作为群聊场景的轻量适配层，复用通用会话内核；
 * - 保留独立类名，避免上层群聊语义被通用实现抹平。
 */
export class GroupChatSessionManager extends BaseChatSessionManager<StoredGroupMessage> {
  constructor(options: ChatSessionManagerOptions) {
    super({
      options,
      sceneLabel: "group",
    });
  }
}

/**
 * 私聊会话管理器。
 *
 * 说明：
 * - 作为私聊场景的轻量适配层，复用通用会话内核；
 * - 保留独立类名，便于后续私聊策略单独分叉。
 */
export class PrivateChatSessionManager extends BaseChatSessionManager<StoredPrivateMessage> {
  constructor(options: ChatSessionManagerOptions) {
    super({
      options,
      sceneLabel: "private",
    });
  }
}
