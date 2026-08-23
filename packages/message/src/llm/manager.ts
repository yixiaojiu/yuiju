import {
  buildChatPlanProposalPrompt,
  buildMessageHistoryUserPrompt,
  changeCharacterMoodByChat,
  chatReplyRulesPrompt,
  createChatPlanChangesProposalTool,
  createToolCallLoggingHooks,
  generateStructuredOutput,
  getCharacterCardPrompt,
  initCharacterStateData,
  messageHistorySchemaPrompt,
} from "@yuiju/utils";
import { getChatModel } from "@yuiju/utils/llm/models";
import { todayEventSearchTool } from "@yuiju/utils/llm/tools/memory-search";
import { queryAvailableInventoryItems } from "@yuiju/utils/llm/tools/query-available-inventory-items";
import { queryStateTool } from "@yuiju/utils/llm/tools/query-state";
import { createChatMemoryRetrievalTool } from "@yuiju/utils/memory/memory-retrieval";
import { Output, stepCountIs } from "ai";
import { z } from "zod";
// import { getGroupMemoryPromptSection } from "@/memory/group-memory";
import { stickerState } from "@/state/sticker";
import { logger } from "@/utils/logger";
import {
  getGroupDisplayName,
  getProtocolMessageId,
  getProtocolMessageSenderName,
  type StoredSatoriGroupMessage,
  type StoredSatoriPrivateMessage,
} from "@/utils/message";
import { buildSatoriGroupSessionKey, buildSatoriPrivateSessionKey } from "@/utils/message/satori";
import { ChatSessionManager } from "./chat-session-manager";

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

export type GroupChatResult =
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

export type PrivateChatResult =
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

export class LLMManager {
  private privateSession: ChatSessionManager<StoredSatoriPrivateMessage>;
  public readonly groupSession: ChatSessionManager<StoredSatoriGroupMessage>;
  /**
   * 记录每个群当前正在执行的回复生成任务，用于在同群新消息到来时取消旧请求。
   */
  private activeGroupChatTaskBySessionId = new Map<string, ActiveChatTask>();
  /**
   * 记录每个群当前“最新那条触发回复的消息 id”。
   *
   * 说明：
   * - 这里保存的是最新请求对应的 `message_id`，不是独立生成的序号；
   * - 生成完成后和发送回复前都会再次比对它，避免旧请求在竞态下误发消息。
   */
  private latestGroupChatRequestIdBySessionId = new Map<string, string>();
  private activePrivateChatTaskBySessionId = new Map<string, ActiveChatTask>();
  private latestPrivateChatRequestIdBySessionId = new Map<string, string>();

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
    const sessionId = this.buildGroupSessionKey(message);
    this.groupSession.recordMessage({
      sessionId,
      sessionLabel: sessionLabel ?? getGroupDisplayName(message),
      message,
    });
    await this.groupSession.saveConversationBackup(sessionId);
  }

  /**
   * 将私聊原始消息写入私聊会话历史，保证回复模型与真实会话事实源保持一致。
   */
  public async recordPrivateMessage(message: StoredSatoriPrivateMessage, sessionLabel?: string) {
    const sessionId = this.buildPrivateSessionKey(message);
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

    if (this.latestGroupChatRequestIdBySessionId.get(sessionId) === input.messageId) {
      this.latestGroupChatRequestIdBySessionId.delete(sessionId);
    }

    const activeTask = this.activeGroupChatTaskBySessionId.get(sessionId);
    if (activeTask?.requestId === input.messageId) {
      logger.info("[message.llm.group] 消息已撤回，取消对应的回复生成", {
        sessionId,
        requestId: input.messageId,
      });
      activeTask.controller.abort("source group message recalled");
      this.activeGroupChatTaskBySessionId.delete(sessionId);
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

    if (this.latestPrivateChatRequestIdBySessionId.get(sessionId) === input.messageId) {
      this.latestPrivateChatRequestIdBySessionId.delete(sessionId);
    }

    const activeTask = this.activePrivateChatTaskBySessionId.get(sessionId);
    if (activeTask?.requestId === input.messageId) {
      logger.info("[message.llm.private] 消息已撤回，取消对应的回复生成", {
        sessionId,
        requestId: input.messageId,
      });
      activeTask.controller.abort("source private message recalled");
      this.activePrivateChatTaskBySessionId.delete(sessionId);
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

  private buildPrivateSessionKey(message: StoredSatoriPrivateMessage): string {
    return message.sessionId;
  }

  private buildGroupSessionKey(message: StoredSatoriGroupMessage): string {
    return message.sessionId;
  }

  /**
   * 判断是否需要回复群消息，并在需要时生成自然语言回复。
   */
  public async chatInGroup(message: StoredSatoriGroupMessage): Promise<GroupChatResult> {
    const sessionKey = this.buildGroupSessionKey(message);
    const requestId = getProtocolMessageId(message);
    const previousTask = this.activeGroupChatTaskBySessionId.get(sessionKey);
    if (previousTask) {
      logger.info("[message.llm.group] 新消息到来，取消同群上一条回复生成", {
        groupName: getGroupDisplayName(message),
        sessionId: sessionKey,
        previousRequestId: previousTask.requestId,
        nextRequestId: requestId,
      });
      previousTask.controller.abort("replaced by newer group chat request");
    }

    const controller = new AbortController();
    this.latestGroupChatRequestIdBySessionId.set(sessionKey, requestId);
    this.activeGroupChatTaskBySessionId.set(sessionKey, {
      controller,
      requestId,
    });

    const { historyJson, summary } = this.groupSession.getHistoryJson(sessionKey);
    const characterState = await initCharacterStateData();

    const systemPrompt = [
      getCharacterCardPrompt(),
      stickerState.getPromptSection(),
      messageHistorySchemaPrompt,
      chatReplyRulesPrompt,
      buildChatPlanProposalPrompt(),
    ].join("\n\n");

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
          scene: "group",
          summary,
          historyJson,
        }),
      };
      const toolNames = Object.keys(tools) as Array<keyof typeof tools>;
      const result = await generateStructuredOutput({
        model: getChatModel(),
        providerOptions: {
          chat: {
            enable_thinking: false,
          },
        },
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
          scene: "message.llm.group",
        }),
        output: Output.object({
          schema: z.object({
            shouldReply: z.boolean().describe("是否回复"),
            reply: z.string().describe("回复内容，shouldReply为false时，这个字段应该是空字符"),
            noReplyReason: z.string().describe("不回复的简短原因"),
            moodDelta: z
              .union([z.literal(-1), z.literal(1)])
              .nullable()
              .transform((value) => value ?? undefined)
              .describe(
                "最新消息导致的心情变化；没有明确变化时填 null；这个字段不代表回复语气强度，回复语气仍要参考当前状态里的心情",
              ),
          }),
        }),
      });

      if (!this.isLatestGroupChatRequest(sessionKey, requestId)) {
        return { status: "cancelled" };
      }

      if (result.output.moodDelta !== undefined) {
        const moodChange = await changeCharacterMoodByChat(result.output.moodDelta);
        this.groupSession.recordMoodChange({
          sessionId: sessionKey,
          delta: moodChange.delta,
        });
        if (moodChange.delta !== 0) {
          logger.info("[message.mood.group] 聊天消息影响心情", {
            groupName: getGroupDisplayName(message),
            sender: getProtocolMessageSenderName(message),
            delta: moodChange.delta,
            currentMood: moodChange.currentMood,
          });
        }
      }

      if (!this.isLatestGroupChatRequest(sessionKey, requestId)) {
        return { status: "cancelled" };
      }

      logger.info("[message.llm.group] LLM 返回群聊决策", {
        groupName: getGroupDisplayName(message),
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
      logger.error("[message.llm.group] 群聊 LLM 调用失败", {
        groupName: getGroupDisplayName(message),
        sessionId: sessionKey,
        requestId,
        error: error?.message,
      });
      return { status: "failed" };
    } finally {
      const activeTask = this.activeGroupChatTaskBySessionId.get(sessionKey);
      if (activeTask?.requestId === requestId) {
        this.activeGroupChatTaskBySessionId.delete(sessionKey);
      }
    }
  }

  public isLatestGroupChatRequest(sessionId: string, requestId: string): boolean {
    return this.latestGroupChatRequestIdBySessionId.get(sessionId) === requestId;
  }

  public async chatWithLLM(message: StoredSatoriPrivateMessage): Promise<PrivateChatResult> {
    const sessionId = this.buildPrivateSessionKey(message);
    const requestId = getProtocolMessageId(message);
    const previousTask = this.activePrivateChatTaskBySessionId.get(sessionId);
    if (previousTask) {
      logger.info("[message.llm.private] 新消息到来，取消同会话上一条回复生成", {
        sessionId,
        previousRequestId: previousTask.requestId,
        nextRequestId: requestId,
      });
      previousTask.controller.abort("replaced by newer private chat request");
    }

    const controller = new AbortController();
    this.latestPrivateChatRequestIdBySessionId.set(sessionId, requestId);
    this.activePrivateChatTaskBySessionId.set(sessionId, {
      controller,
      requestId,
    });

    const { historyJson, summary } = this.privateSession.getHistoryJson(sessionId);
    const characterState = await initCharacterStateData();
    const sessionLabel = getProtocolMessageSenderName(message);
    const systemPrompt = [
      getCharacterCardPrompt(),
      stickerState.getPromptSection(),
      messageHistorySchemaPrompt,
      chatReplyRulesPrompt,
      buildChatPlanProposalPrompt(),
    ].join("\n\n");

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
          scene: "private",
          summary,
          historyJson,
        }),
      };
      const toolNames = Object.keys(tools) as Array<keyof typeof tools>;
      const result = await generateStructuredOutput({
        model: getChatModel(),
        providerOptions: {
          chat: {
            enable_thinking: false,
          },
        },
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
          scene: "message.llm.private",
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
            moodDelta: z
              .union([z.literal(-1), z.literal(1)])
              .nullable()
              .transform((value) => value ?? undefined)
              .describe(
                "最新消息导致的心情变化；没有明确变化时填 null；这个字段不代表回复语气强度，回复语气仍要参考当前状态里的心情",
              ),
          }),
        }),
      });

      if (!this.isLatestPrivateChatRequest(sessionId, requestId)) {
        return { status: "cancelled" };
      }

      if (result.output.moodDelta !== undefined) {
        const moodChange = await changeCharacterMoodByChat(result.output.moodDelta);
        this.privateSession.recordMoodChange({
          sessionId,
          delta: moodChange.delta,
        });
        if (moodChange.delta !== 0) {
          logger.info("[message.mood.private] 聊天消息影响心情", {
            sessionLabel,
            delta: moodChange.delta,
            currentMood: moodChange.currentMood,
          });
        }
      }

      if (!this.isLatestPrivateChatRequest(sessionId, requestId)) {
        return { status: "cancelled" };
      }

      logger.info("[message.llm.private] LLM 返回私聊决策", {
        sessionLabel,
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
      logger.error("[message.llm.private] 私聊 LLM 调用失败", {
        sessionId,
        sessionLabel,
        error: error?.message,
      });
      return { status: "failed" };
    } finally {
      const activeTask = this.activePrivateChatTaskBySessionId.get(sessionId);
      if (activeTask?.requestId === requestId) {
        this.activePrivateChatTaskBySessionId.delete(sessionId);
      }
    }
  }

  public isLatestPrivateChatRequest(sessionId: string, requestId: string): boolean {
    return this.latestPrivateChatRequestIdBySessionId.get(sessionId) === requestId;
  }
}

// 导出默认实例
export const llmManager = new LLMManager();
