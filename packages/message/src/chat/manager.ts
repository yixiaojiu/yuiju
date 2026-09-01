import {
  buildMessageHistoryUserPrompt,
  createChatPlanChangesProposalTool,
  createToolCallLoggingHooks,
  generateStructuredOutput,
  initCharacterStateData,
} from "@yuiju/utils";
import { getPromptCustomizationOverrides } from "@yuiju/utils/db/operations/prompt-customization";
import { getChatModel } from "@yuiju/utils/llm/models";
import { todayEventSearchTool } from "@yuiju/utils/llm/tools/memory-search";
import { queryAvailableInventoryItems } from "@yuiju/utils/llm/tools/query-available-inventory-items";
import { queryStateTool } from "@yuiju/utils/llm/tools/query-state";
import {
  createBatchChatMemoryRetrievalTool,
  createChatMemoryRetrievalTool,
} from "@yuiju/utils/memory/memory-retrieval";
import { buildChatSystemPrompt } from "@yuiju/utils/prompt/message";
import { getPromptCustomizationContent } from "@yuiju/utils/prompt/prompt-customization";
import { Output, stepCountIs } from "ai";
import { z } from "zod";
// import { getGroupMemoryPromptSection } from "@/memory/group-memory";
import { stickerState } from "@/state/sticker";
import { logger } from "@/utils/logger";
import {
  getProtocolMessageId,
  getProtocolMessageSenderName,
  type StoredSatoriChatMessage,
  type StoredSatoriGroupMessage,
  type StoredSatoriPrivateMessage,
} from "@/utils/message";
import { buildSatoriGroupSessionKey, buildSatoriPrivateSessionKey } from "@/utils/message/satori";
import { ChatSessionManager } from "./session-manager";

async function getEffectiveChatSystemPrompt(): Promise<string> {
  const overrides = await getPromptCustomizationOverrides(["character", "world", "chat"]);

  return buildChatSystemPrompt({
    characterPrompt: getPromptCustomizationContent("character", overrides),
    worldPrompt: getPromptCustomizationContent("world", overrides),
    chatPrompt: getPromptCustomizationContent("chat", overrides),
    stickerPrompt: stickerState.getPromptSection(),
  });
}

interface ActiveChatTask {
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

export class ChatManager {
  private privateSession: ChatSessionManager<StoredSatoriPrivateMessage>;
  public readonly groupSession: ChatSessionManager<StoredSatoriGroupMessage>;
  /**
   * 记录每个会话当前正在执行的回复生成任务，用于在同会话新消息到来时取消旧请求。
   */
  private activeChatTaskBySessionId = new Map<string, ActiveChatTask>();
  /**
   * 记录每个会话当前“最新那条触发回复的消息 id”。
   *
   * 说明：
   * - 这里保存的是最新请求对应的 `message_id`，不是独立生成的序号；
   * - 生成完成后和发送回复前都会再次比对它，避免旧请求在竞态下误发消息。
   */
  private latestChatRequestIdBySessionId = new Map<string, string>();

  constructor() {
    this.privateSession = new ChatSessionManager<StoredSatoriPrivateMessage>({
      sceneLabel: "private",
      options: {
        conversationLimit: 20,
        conversationTtlMs: 8 * 60 * 60 * 1000,
        summaryFlushMessageCount: 15,
        summaryFlushIdleMs: 30 * 60 * 1000,
        episodeIdleMs: 12 * 60 * 60 * 1000,
        episodeMessageCountLimit: 30,
      },
    });
    this.groupSession = new ChatSessionManager<StoredSatoriGroupMessage>({
      sceneLabel: "group",
      options: {
        conversationLimit: 20,
        conversationTtlMs: 8 * 60 * 60 * 1000,
        summaryFlushMessageCount: 15,
        summaryFlushIdleMs: 30 * 60 * 1000,
        episodeIdleMs: 12 * 60 * 60 * 1000,
        episodeMessageCountLimit: 30,
      },
    });
  }

  /**
   * 将群原始消息写入群会话历史，保证群聊模型拿到稳定上下文。
   */
  public async recordGroupMessage(message: StoredSatoriGroupMessage, sessionLabel?: string) {
    const sessionId = message.sessionId;
    this.groupSession.recordMessage({
      sessionId,
      sessionLabel: sessionLabel ?? message.sessionLabel,
      message,
    });
    await this.groupSession.saveConversationBackup(sessionId);
  }

  /**
   * 将私聊原始消息写入私聊会话历史，保证回复模型与真实会话事实源保持一致。
   */
  public async recordPrivateMessage(message: StoredSatoriPrivateMessage, sessionLabel?: string) {
    const sessionId = message.sessionId;
    this.privateSession.recordMessage({
      sessionId,
      sessionLabel: sessionLabel ?? getProtocolMessageSenderName(message),
      message,
    });
    await this.privateSession.saveConversationBackup(sessionId);
  }

  public async recordGroupMessageRecall(input: {
    platform: string;
    channelId: string;
    messageId: string;
    timestamp: number;
  }) {
    const sessionId = buildSatoriGroupSessionKey(input.platform, input.channelId);
    const recallMessage = this.groupSession.recordLastMessageRecall({
      sessionId,
      messageId: input.messageId,
      timestamp: input.timestamp,
    });
    if (!recallMessage) {
      return null;
    }

    if (this.latestChatRequestIdBySessionId.get(sessionId) === input.messageId) {
      this.latestChatRequestIdBySessionId.delete(sessionId);
    }

    const activeTask = this.activeChatTaskBySessionId.get(sessionId);
    if (activeTask?.requestId === input.messageId) {
      logger.info("[message.llm.group] 消息已撤回，取消对应的回复生成", {
        sessionId,
        requestId: input.messageId,
      });
      activeTask.controller.abort("source group message recalled");
      this.activeChatTaskBySessionId.delete(sessionId);
    }

    await this.groupSession.saveConversationBackup(sessionId);
    return recallMessage;
  }

  public async recordPrivateMessageRecall(input: {
    platform: string;
    channelId: string;
    messageId: string;
    timestamp: number;
  }) {
    const sessionId = buildSatoriPrivateSessionKey(input.platform, input.channelId);
    const recallMessage = this.privateSession.recordLastMessageRecall({
      sessionId,
      messageId: input.messageId,
      timestamp: input.timestamp,
    });
    if (!recallMessage) {
      return null;
    }

    if (this.latestChatRequestIdBySessionId.get(sessionId) === input.messageId) {
      this.latestChatRequestIdBySessionId.delete(sessionId);
    }

    const activeTask = this.activeChatTaskBySessionId.get(sessionId);
    if (activeTask?.requestId === input.messageId) {
      logger.info("[message.llm.private] 消息已撤回，取消对应的回复生成", {
        sessionId,
        requestId: input.messageId,
      });
      activeTask.controller.abort("source private message recalled");
      this.activeChatTaskBySessionId.delete(sessionId);
    }

    await this.privateSession.saveConversationBackup(sessionId);
    return recallMessage;
  }

  public async restoreConversationBackups(): Promise<void> {
    const [group, privateChat] = await Promise.all([
      this.groupSession.restoreConversationBackup(),
      this.privateSession.restoreConversationBackup(),
    ]);

    logger.info("[message.session] Redis 会话备份恢复完成", {
      group,
      private: privateChat,
    });
  }

  /**
   * 判断是否需要回复聊天消息，并在需要时生成自然语言回复。
   */
  public async chat(message: StoredSatoriChatMessage): Promise<ChatResult> {
    const sessionId = message.sessionId;
    const sessionLabel = message.sessionLabel;
    const sender = getProtocolMessageSenderName(message);
    const requestId = getProtocolMessageId(message);
    const session = message.scene === "group" ? this.groupSession : this.privateSession;
    const previousTask = this.activeChatTaskBySessionId.get(sessionId);
    if (previousTask) {
      logger.info("[message.llm.chat] 新消息到来，取消同会话上一条回复生成", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        previousRequestId: previousTask.requestId,
      });
      previousTask.controller.abort("replaced by newer chat request");
    }

    const controller = new AbortController();
    this.latestChatRequestIdBySessionId.set(sessionId, requestId);
    this.activeChatTaskBySessionId.set(sessionId, {
      controller,
      requestId,
    });

    const { historyJson, summary } = session.getHistoryJson(sessionId);
    const characterState = await initCharacterStateData();
    const systemPrompt = await getEffectiveChatSystemPrompt();

    try {
      const memoryRetrieval = createChatMemoryRetrievalTool({
        summary,
        historyJson,
        abortSignal: controller.signal,
        semanticDiarySearchCallLimit: 2,
      });
      const tools = {
        retrieveMemory: memoryRetrieval.tool,
        todayEventSearch: todayEventSearchTool,
        queryStateTool,
        queryAvailableInventoryItems,
        proposePlanChanges: createChatPlanChangesProposalTool({
          summary,
          historyJson,
        }),
      };
      const toolNames = Object.keys(tools) as Array<keyof typeof tools>;
      const result = await generateStructuredOutput({
        model: getChatModel(),
        instructions: systemPrompt,
        messages: [
          {
            role: "user",
            content: buildMessageHistoryUserPrompt({
              summary,
              historyJson,
              characterState,
            }),
          },
        ],
        tools,
        prepareStep: () => {
          if (!memoryRetrieval.hasBeenCalled()) {
            return;
          }

          return {
            activeTools: toolNames.filter((toolName) => toolName !== "retrieveMemory"),
          };
        },
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
        ...createToolCallLoggingHooks({
          scene: "message.llm.chat",
        }),
        output: Output.object({
          schema: z.object({
            shouldReply: z.boolean().describe("是否回复"),
            reply: z
              .string()
              .describe(
                "回复内容，可以包含合法的 [[sticker:key]] 表情包标记；shouldReply为false时，这个字段应该是空字符",
              ),
            noReplyReason: z.string().describe("不回复的简短原因"),
          }),
        }),
      });

      if (!this.isLatestChatRequest(sessionId, requestId)) {
        return { status: "cancelled" };
      }

      logger.info("[message.llm.chat] LLM 返回聊天决策", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        shouldReply: result.output.shouldReply,
        reply: result.output.reply,
        noReplyReason: result.output.noReplyReason,
      });

      return {
        status: "completed",
        requestId,
        shouldReply: result.output.shouldReply,
        reply: result.output.reply,
        noReplyReason: result.output.noReplyReason,
      };
    } catch (error: any) {
      if (controller.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("[message.llm.chat] 聊天 LLM 调用失败", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        error: error?.message,
      });
      return { status: "failed" };
    } finally {
      const activeTask = this.activeChatTaskBySessionId.get(sessionId);
      if (activeTask?.requestId === requestId) {
        this.activeChatTaskBySessionId.delete(sessionId);
      }
    }
  }

  /**
   * 集中查看一批新消息，并使用不限制语义日记检索次数的深度思考生成回复。
   */
  public async chatBatch(message: StoredSatoriChatMessage): Promise<ChatResult> {
    const sessionId = message.sessionId;
    const sessionLabel = message.sessionLabel;
    const sender = getProtocolMessageSenderName(message);
    const requestId = getProtocolMessageId(message);
    const session = message.scene === "group" ? this.groupSession : this.privateSession;
    const previousTask = this.activeChatTaskBySessionId.get(sessionId);
    if (previousTask) {
      logger.info("[message.llm.chat] 新消息到来，取消同会话上一条回复生成", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        previousRequestId: previousTask.requestId,
      });
      previousTask.controller.abort("replaced by newer chat request");
    }

    const controller = new AbortController();
    this.latestChatRequestIdBySessionId.set(sessionId, requestId);
    this.activeChatTaskBySessionId.set(sessionId, {
      controller,
      requestId,
    });

    const { historyJson, summary } = session.getHistoryJson(sessionId);
    const characterState = await initCharacterStateData();
    const systemPrompt = await getEffectiveChatSystemPrompt();

    try {
      const retrieveMemory = createBatchChatMemoryRetrievalTool({
        summary,
        historyJson,
        abortSignal: controller.signal,
      });
      const tools = {
        retrieveMemory,
        todayEventSearch: todayEventSearchTool,
        queryStateTool,
        queryAvailableInventoryItems,
        proposePlanChanges: createChatPlanChangesProposalTool({
          summary,
          historyJson,
        }),
      };
      const result = await generateStructuredOutput({
        model: getChatModel(),
        instructions: systemPrompt,
        messages: [
          {
            role: "user",
            content: buildMessageHistoryUserPrompt({
              summary,
              historyJson,
              characterState,
            }),
          },
        ],
        tools,
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
        providerOptions: {
          chat: {
            enable_thinking: true,
          },
        },
        ...createToolCallLoggingHooks({
          scene: "message.llm.chat",
        }),
        output: Output.object({
          schema: z.object({
            shouldReply: z.boolean().describe("是否回复"),
            reply: z
              .string()
              .describe(
                "回复内容，可以包含合法的 [[sticker:key]] 表情包标记；shouldReply为false时，这个字段应该是空字符",
              ),
            noReplyReason: z.string().describe("不回复的简短原因"),
          }),
        }),
      });

      if (!this.isLatestChatRequest(sessionId, requestId)) {
        return { status: "cancelled" };
      }

      logger.info("[message.llm.chat] LLM 返回聊天决策", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        shouldReply: result.output.shouldReply,
        reply: result.output.reply,
        noReplyReason: result.output.noReplyReason,
      });

      return {
        status: "completed",
        requestId,
        shouldReply: result.output.shouldReply,
        reply: result.output.reply,
        noReplyReason: result.output.noReplyReason,
      };
    } catch (error: any) {
      if (controller.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("[message.llm.chat] 聊天 LLM 调用失败", {
        scene: message.scene,
        sessionId,
        sessionLabel,
        sender,
        requestId,
        error: error?.message,
      });
      return { status: "failed" };
    } finally {
      const activeTask = this.activeChatTaskBySessionId.get(sessionId);
      if (activeTask?.requestId === requestId) {
        this.activeChatTaskBySessionId.delete(sessionId);
      }
    }
  }

  public startReplyWindow(input: {
    message: StoredSatoriChatMessage;
    delayMs: number;
    onElapsed: (message: StoredSatoriChatMessage) => void;
  }): boolean {
    const session = input.message.scene === "group" ? this.groupSession : this.privateSession;
    return session.startReplyWindow({
      sessionId: input.message.sessionId,
      delayMs: input.delayMs,
      onElapsed: input.onElapsed,
    });
  }

  public closeReplyWindow(message: StoredSatoriChatMessage): boolean {
    const session = message.scene === "group" ? this.groupSession : this.privateSession;
    return session.closeReplyWindow(message.sessionId);
  }

  public isReplyWindowOpen(message: StoredSatoriChatMessage): boolean {
    const session = message.scene === "group" ? this.groupSession : this.privateSession;
    return session.isReplyWindowOpen(message.sessionId);
  }

  public isLatestChatRequest(sessionId: string, requestId: string): boolean {
    return this.latestChatRequestIdBySessionId.get(sessionId) === requestId;
  }
}

// 导出默认实例
export const chatManager = new ChatManager();
