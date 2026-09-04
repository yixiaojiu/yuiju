import {
  buildMessageSummaryPrompt,
  getTimeWithWeekday,
  isDev,
  saveMemoryEpisode,
  summarizeConversationMessages,
} from "@yuiju/utils";
import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getFlashModel } from "@yuiju/utils/llm/models";
import {
  deleteChatSessionConversationBackups,
  readChatSessionConversationBackups,
  saveChatSessionConversationBackup,
} from "@yuiju/utils/redis/chat-session";
import { generateText } from "ai";
import dayjs from "dayjs";
import {
  getProtocolMessageId,
  getProtocolMessageSenderName,
  getProtocolMessageTimestampMs,
  type HistoryJsonItem,
  projectStoredMessageContent,
  type StoredSatoriChatMessage,
  type StoredSatoriGroupMessage,
  type StoredSatoriPrivateMessage,
} from "@/utils/message";
import type { StoredSatoriRecallMessage } from "@/utils/message/types";
import { buildConversationEpisode } from "../memory/episode-builder";
import {
  writePersonMemoryUpdatesForGroupChatWindow,
  writePersonMemoryUpdatesForPrivateChatWindow,
} from "../memory/person-memory";
import type {
  ChatHistoryOptions,
  ChatMessageInput,
  ChatMessageRecallInput,
  ChatSessionManagerInput,
  ConversationState,
  EpisodeWindowState,
  RollingSummaryChunkState,
  SessionHistoryContext,
} from "./types";

/**
 * 服务启动后，恢复对话的最长间隔时间。
 * 5min
 */
const CONVERSATION_RECOVERY_MAX_IDLE_MS = 5 * 60 * 1000;

/**
 * 群聊/私聊共享的聊天会话状态管理。
 *
 * 说明：
 * - 最近原始消息、滚动摘要块、episode 窗口分开维护，避免三个职责共用一个阈值；
 * - 上层初始化时显式传入 sceneLabel，避免为群聊/私聊增加只固定参数的包装类。
 */
export class ChatSessionManager<TMessage extends StoredSatoriChatMessage> {
  private conversationBySessionId = new Map<string, ConversationState<TMessage>>();
  private summaryChunkBySessionId = new Map<string, RollingSummaryChunkState<TMessage>>();
  private episodeStateBySessionId = new Map<string, EpisodeWindowState<TMessage>>();
  private summaryBySessionId = new Map<string, string>();
  private pendingSummaryBySessionId = new Map<string, Promise<void>>();
  private conversationLimit: number;
  private conversationTtlMs: number;
  private summaryFlushMessageCount: number;
  private summaryFlushIdleMs: number;
  private episodeMessageCountLimit: number;
  private isDev: boolean;
  private sceneLabel: "group" | "private";

  constructor(input: ChatSessionManagerInput) {
    const { options, sceneLabel } = input;

    this.conversationLimit = options.conversationLimit;
    this.conversationTtlMs = options.conversationTtlMs;
    this.summaryFlushMessageCount = options.summaryFlushMessageCount;
    this.summaryFlushIdleMs = options.summaryFlushIdleMs;
    this.episodeMessageCountLimit = options.episodeMessageCountLimit;
    this.sceneLabel = sceneLabel;
    this.isDev = isDev();
  }

  recordMessage(input: ChatMessageInput<TMessage>) {
    this.appendConversationEntry(input);
    this.appendSummaryChunkMessage(input);
    this.appendEpisodeMessage(input);
  }

  recordLastMessageRecall(
    input: ChatMessageRecallInput,
  ): StoredSatoriRecallMessage<TMessage> | null {
    const conversationState = this.conversationBySessionId.get(input.sessionId);
    if (!conversationState) {
      return null;
    }

    const conversation = conversationState.messages;
    const lastMessage = conversation.at(-1);
    if (!lastMessage || getProtocolMessageId(lastMessage) !== input.messageId) {
      return null;
    }

    const recallMessage = {
      ...lastMessage,
      recordType: "recall",
      recalledMessageId: input.messageId,
      messageId: `recall:${input.messageId}:${input.timestamp}`,
      timestamp: input.timestamp,
      elements: [],
      content: [
        {
          type: "recall",
          data: {
            text: "撤回了一条消息",
          },
        },
      ],
      rawSession: undefined,
    } as unknown as StoredSatoriRecallMessage<TMessage>;

    conversation.pop();
    conversation.push(recallMessage);

    const summaryChunk = this.summaryChunkBySessionId.get(input.sessionId);
    const lastSummaryMessage = summaryChunk?.messages.at(-1);
    if (
      summaryChunk &&
      lastSummaryMessage &&
      getProtocolMessageId(lastSummaryMessage) === input.messageId
    ) {
      summaryChunk.messages.pop();
      summaryChunk.messages.push(recallMessage);
      summaryChunk.lastTsMs = input.timestamp;
      if (summaryChunk.messages.length === 1) {
        summaryChunk.chunkStartMs = input.timestamp;
      }
    }

    const episodeState = this.episodeStateBySessionId.get(input.sessionId);
    const lastEpisodeMessage = episodeState?.messages.at(-1);
    if (
      episodeState &&
      lastEpisodeMessage &&
      getProtocolMessageId(lastEpisodeMessage) === input.messageId
    ) {
      episodeState.messages.pop();
      episodeState.messages.push(recallMessage);
      episodeState.lastTsMs = input.timestamp;
      if (episodeState.messages.length === 1) {
        episodeState.windowStartMs = input.timestamp;
      }
    }

    return recallMessage;
  }

  startReplyWindow(input: {
    sessionId: string;
    delayMs: number;
    onElapsed: (message: TMessage) => void;
  }): boolean {
    const conversationState = this.conversationBySessionId.get(input.sessionId)!;
    if (conversationState.replyWindowTimer) {
      return false;
    }

    conversationState.replyWindowTimer = setTimeout(() => {
      conversationState.replyWindowTimer = undefined;
      input.onElapsed(conversationState.messages.at(-1)!);
    }, input.delayMs);
    return true;
  }

  closeReplyWindow(sessionId: string): boolean {
    const conversationState = this.conversationBySessionId.get(sessionId)!;
    if (!conversationState.replyWindowTimer) {
      return false;
    }

    clearTimeout(conversationState.replyWindowTimer);
    conversationState.replyWindowTimer = undefined;
    return true;
  }

  isReplyWindowOpen(sessionId: string): boolean {
    return this.conversationBySessionId.get(sessionId)!.replyWindowTimer !== undefined;
  }

  async saveConversationBackup(sessionId: string): Promise<void> {
    const messages = this.conversationBySessionId.get(sessionId)?.messages ?? [];
    await saveChatSessionConversationBackup({
      scene: this.sceneLabel,
      sessionId,
      backup: {
        updatedAt: Date.now(),
        messages: messages.map(({ rawSession: _rawSession, ...message }) => message),
      },
    });
  }

  async restoreConversationBackup(): Promise<{
    restoredSessionCount: number;
    discardedSessionCount: number;
  }> {
    const backups = await readChatSessionConversationBackups<Omit<TMessage, "rawSession">>(
      this.sceneLabel,
    );
    const discardedSessionIds: string[] = [];
    let restoredSessionCount = 0;

    for (const [sessionId, backup] of Object.entries(backups)) {
      if (Date.now() - backup.updatedAt > CONVERSATION_RECOVERY_MAX_IDLE_MS) {
        discardedSessionIds.push(sessionId);
        continue;
      }

      const messages = this.trimConversation(backup.messages as TMessage[]);
      if (!messages.length) {
        discardedSessionIds.push(sessionId);
        continue;
      }

      this.conversationBySessionId.set(sessionId, { messages });
      restoredSessionCount += 1;
    }

    if (discardedSessionIds.length) {
      await deleteChatSessionConversationBackups(this.sceneLabel, discardedSessionIds);
    }

    return {
      restoredSessionCount,
      discardedSessionCount: discardedSessionIds.length,
    };
  }

  getHistoryJson(sessionId: string, options: ChatHistoryOptions = {}): SessionHistoryContext {
    const conversationState = this.conversationBySessionId.get(sessionId);
    const list = conversationState?.messages ?? [];
    const trimmedMessages = this.trimConversation(list);
    if (conversationState && trimmedMessages.length !== list.length) {
      conversationState.messages = trimmedMessages;
    }

    const summary = this.summaryBySessionId.get(sessionId);
    const promptMessages = options.limit
      ? trimmedMessages.slice(Math.max(trimmedMessages.length - options.limit, 0))
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

  async flushUserWindows(): Promise<void> {
    const sessionIds = new Set([
      ...this.summaryChunkBySessionId.keys(),
      ...this.episodeStateBySessionId.keys(),
    ]);

    await Promise.all([...sessionIds].map((sessionId) => this.flushUserWindow(sessionId)));
  }

  private appendConversationEntry(input: ChatMessageInput<TMessage>) {
    const conversationState = this.conversationBySessionId.get(input.sessionId);
    const list = conversationState?.messages ?? [];
    list.push(input.message);
    const messages = this.trimConversation(list);
    if (conversationState) {
      conversationState.messages = messages;
      return;
    }

    this.conversationBySessionId.set(input.sessionId, { messages });
  }

  /**
   * 维护摘要增量块。
   *
   * 说明：
   * - 静默超过阈值时，旧块会先异步压进滚动摘要，再开启新块；
   * - 达到条数阈值时立即封口刷新，避免活跃会话里的旧消息长期脱离摘要。
   */
  private appendSummaryChunkMessage(input: ChatMessageInput<TMessage>) {
    const messageTimeMs = getProtocolMessageTimestampMs(input.message);
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
   * - 达到消息数上限时，当前窗口立即归档；
   * - 调用方可以显式归档尚未达到上限的窗口；
   * - 摘要刷新不会影响 episode 的窗口边界。
   */
  private appendEpisodeMessage(input: ChatMessageInput<TMessage>) {
    const messageTimeMs = getProtocolMessageTimestampMs(input.message);
    const currentState = this.episodeStateBySessionId.get(input.sessionId);

    if (!currentState) {
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
    void this.finalizeEpisodeWindow(currentState).catch((error) => {
      console.error(`Failed to write ${this.sceneLabel} chat window episode:`, error);
    });
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
    await this.writeChatWindowEpisode({
      sessionLabel: state.sessionLabel,
      state,
      isDev: this.isDev,
    });
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
    const summaryPrompt = buildMessageSummaryPrompt({
      sessionLabel: input.sessionLabel,
      previousSummary: input.previousSummary,
      transcript,
    });

    const result = await generateText({
      model: getFlashModel(),
      telemetry: getLangfuseTelemetry(),
      instructions: summaryPrompt.instructions,
      providerOptions: {
        flash: {
          enable_thinking: false,
        },
      },
      prompt: summaryPrompt.prompt,
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
      saveMemoryEpisode(episode),
      this.writePersonMemoryUpdatesForChatWindow(input.state).catch((error) => {
        console.error(`Failed to update ${this.sceneLabel} person memory:`, error);
      }),
      // this.writeGroupMemoryForChatWindow(input.state).catch((error) => {
      //   console.error("Failed to update group memory:", error);
      // }),
    ]);
  }

  private async writePersonMemoryUpdatesForChatWindow(state: EpisodeWindowState<TMessage>) {
    if (this.sceneLabel === "private") {
      await writePersonMemoryUpdatesForPrivateChatWindow(
        state as EpisodeWindowState<StoredSatoriPrivateMessage>,
      );
      return;
    }

    await writePersonMemoryUpdatesForGroupChatWindow(
      state as EpisodeWindowState<StoredSatoriGroupMessage>,
    );
  }

  /**
   * 构建供摘要与 history JSON 复用的结构化历史项。
   */
  private buildHistoryItems(messages: TMessage[]): HistoryJsonItem[] {
    return messages.map((message) => {
      return {
        speaker: getProtocolMessageSenderName(message),
        time: getTimeWithWeekday(dayjs(getProtocolMessageTimestampMs(message))),
        content: projectStoredMessageContent(message),
      };
    });
  }

  private trimConversation(list: TMessage[]): TMessage[] {
    const cutoffMs = Date.now() - this.conversationTtlMs;
    const filtered = list.filter((message) => getProtocolMessageTimestampMs(message) >= cutoffMs);

    return filtered.length > this.conversationLimit
      ? filtered.slice(filtered.length - this.conversationLimit)
      : filtered;
  }
}
