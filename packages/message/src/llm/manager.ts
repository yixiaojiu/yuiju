import {
  buildMessageHistoryUserPrompt,
  diarySearchTool,
  generateStructuredOutput,
  getCharacterCardPrompt,
  getGroupReplyDecisionSystemPrompt,
  getPersonMemoryTool,
  listPersonMemoriesTool,
  minimaxModel,
  queryStateTool,
  queryWorldMapTool,
  siliconflow,
  todayEventSearchTool,
} from "@yuiju/utils";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { stickerState } from "@/state/sticker";
import { logger } from "@/utils/logger";
import {
  getGroupDisplayName,
  getProtocolMessageSenderName,
  type StoredGroupMessage,
  type StoredPrivateMessage,
} from "@/utils/message";
import {
  type AbstractChatSessionManager,
  GroupChatSessionManager,
  PrivateChatSessionManager,
} from "./chat-session-manager";

type ActiveGroupChatTask = {
  controller: AbortController;
  /**
   * 直接复用触发本次回复生成的群消息 `message_id`，用于识别“当前群里最新的一次回复生成请求”。
   *
   * 说明：
   * - 仅依赖 abort() 不足以完全避免竞态，旧请求可能在被取消前后恰好返回；
   * - 因此在生成完成和真正发送回复前，都要再次校验 requestId 是否仍然是该群最新值；
   * - 只要 requestId 已经过期，就把这次结果视为失效，禁止继续发送消息。
   */
  requestId: number;
};

export type GroupChatResult =
  | {
      status: "completed";
      requestId: number;
      text: string;
    }
  | {
      status: "cancelled";
    };

export class LLMManager {
  private privateSession: AbstractChatSessionManager<StoredPrivateMessage>;
  private groupSession: AbstractChatSessionManager<StoredGroupMessage>;
  /**
   * 记录每个群当前正在执行的回复生成任务，用于在同群新消息到来时取消旧请求。
   */
  private activeGroupChatTaskByGroupId = new Map<number, ActiveGroupChatTask>();
  /**
   * 记录每个群当前“最新那条触发回复的消息 id”。
   *
   * 说明：
   * - 这里保存的是最新请求对应的 `message_id`，不是独立生成的序号；
   * - 生成完成后和发送回复前都会再次比对它，避免旧请求在竞态下误发消息。
   */
  private latestGroupChatRequestIdByGroupId = new Map<number, number>();

  constructor() {
    this.privateSession = new PrivateChatSessionManager({
      conversationLimit: 20,
      conversationTtlMs: 8 * 60 * 60 * 1000,
      summaryFlushMessageCount: 15,
      summaryFlushIdleMs: 30 * 60 * 1000,
      episodeIdleMs: 12 * 60 * 60 * 1000,
      episodeMessageCountLimit: 30,
    });
    this.groupSession = new GroupChatSessionManager({
      conversationLimit: 20,
      conversationTtlMs: 8 * 60 * 60 * 1000,
      summaryFlushMessageCount: 15,
      summaryFlushIdleMs: 30 * 60 * 1000,
      episodeIdleMs: 12 * 60 * 60 * 1000,
      episodeMessageCountLimit: 30,
    });
  }

  /**
   * 将群原始消息写入群会话历史，保证裁决模型与回复模型拿到的是同一份上下文。
   */
  public recordGroupMessage(message: StoredGroupMessage, sessionLabel?: string) {
    this.groupSession.recordMessage({
      sessionId: this.buildGroupSessionKey(message.group_id),
      sessionLabel: sessionLabel ?? getGroupDisplayName(message),
      message,
    });
  }

  /**
   * 将私聊原始消息写入私聊会话历史，保证回复模型与真实会话事实源保持一致。
   */
  public recordPrivateMessage(message: StoredPrivateMessage, sessionLabel?: string) {
    this.privateSession.recordMessage({
      sessionId: this.buildPrivateSessionKey(message.user_id),
      sessionLabel: sessionLabel ?? getProtocolMessageSenderName(message),
      message,
    });
  }

  /**
   * 使用小模型判断普通群消息是否值得回复。
   *
   * 说明：
   * - 这里只返回 shouldReply，不承担具体回复生成；
   * - 无论是否直接对悠酱说话（例如 @ 悠酱），都统一走这个流程判断是否回复；
   * - handler 只会在确定需要回复后，再判断是否应附带引用回复。
   */
  public async shouldReplyGroupMessage(
    message: StoredGroupMessage,
    directedType?: "at" | "reply",
  ): Promise<boolean> {
    const { historyJson, summary } = await this.groupSession.getHistoryJson(
      this.buildGroupSessionKey(message.group_id),
      10,
    );

    const { output } = await generateStructuredOutput({
      model: minimaxModel,
      // providerOptions: {
      //   Siliconflow: {
      //     enable_thinking: false,
      //   },
      // },
      system: getGroupReplyDecisionSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildMessageHistoryUserPrompt({
            summary,
            historyJson,
            latestMessageDirectedType: directedType,
          }),
        },
      ],
      output: Output.object({
        schema: z.object({
          shouldReply: z.boolean().describe("是否应该回复这条群消息"),
        }),
      }),
    });

    logger.info(`[shouldReplyGroupMessage] ${output.shouldReply ? "回复" : "不回复"}`);

    return output.shouldReply;
  }

  private buildPrivateSessionKey(userId: number): string {
    return `private:${userId}`;
  }

  private buildGroupSessionKey(groupId: number): string {
    return `group:${groupId}`;
  }

  /**
   * 使用主回复模型为群聊生成自然语言回复。
   */
  public async chatInGroup(message: StoredGroupMessage): Promise<GroupChatResult> {
    const groupId = message.group_id;
    const sessionKey = this.buildGroupSessionKey(groupId);
    const requestId = message.message_id;
    const previousTask = this.activeGroupChatTaskByGroupId.get(groupId);
    if (previousTask) {
      logger.info("[message.llm.group] 新消息到来，取消同群上一条回复生成", {
        groupId,
        groupName: getGroupDisplayName(message),
        previousRequestId: previousTask.requestId,
        nextRequestId: requestId,
      });
      previousTask.controller.abort("replaced by newer group chat request");
    }

    const controller = new AbortController();
    this.latestGroupChatRequestIdByGroupId.set(groupId, requestId);
    this.activeGroupChatTaskByGroupId.set(groupId, {
      controller,
      requestId,
    });

    const { historyJson, summary } = await this.groupSession.getHistoryJson(sessionKey);

    const systemPrompt = [
      getCharacterCardPrompt(),
      stickerState.buildPromptSection(),
      "## 当前聊天场景",
      `你现在正在 QQ 群「${getGroupDisplayName(message)}」`,
    ].join("\n\n");

    try {
      const result = await generateText({
        model: minimaxModel,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: buildMessageHistoryUserPrompt({
              summary,
              historyJson,
            }),
          },
        ],
        tools: {
          todayEventSearch: todayEventSearchTool,
          diarySearch: diarySearchTool,
          listPersonMemories: listPersonMemoriesTool,
          getPersonMemory: getPersonMemoryTool,
          queryStateTool: queryStateTool,
          queryWorldMap: queryWorldMapTool,
        },
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
      });

      if (!this.isLatestGroupChatRequest(groupId, requestId)) {
        return { status: "cancelled" };
      }

      logger.info("[message.llm.group] LLM 返回群聊回复", {
        groupName: getGroupDisplayName(message),
        text: result.text,
      });

      return {
        status: "completed",
        requestId,
        text: result.text,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: "cancelled" };
      }
      throw error;
    } finally {
      const activeTask = this.activeGroupChatTaskByGroupId.get(groupId);
      if (activeTask?.requestId === requestId) {
        this.activeGroupChatTaskByGroupId.delete(groupId);
      }
    }
  }

  public isLatestGroupChatRequest(groupId: number, requestId: number): boolean {
    return this.latestGroupChatRequestIdByGroupId.get(groupId) === requestId;
  }

  public async chatWithLLM(message: StoredPrivateMessage) {
    const sessionId = this.buildPrivateSessionKey(message.user_id);
    const { historyJson, summary } = await this.privateSession.getHistoryJson(sessionId);
    const systemPrompt = [getCharacterCardPrompt(), stickerState.buildPromptSection()].join("\n\n");

    const result = await generateText({
      model: siliconflow("Pro/moonshotai/Kimi-K2.5"),
      providerOptions: {
        Siliconflow: {
          enable_thinking: false,
        },
      },
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: buildMessageHistoryUserPrompt({
            summary,
            historyJson,
          }),
        },
      ],
      tools: {
        todayEventSearch: todayEventSearchTool,
        diarySearch: diarySearchTool,
        listPersonMemories: listPersonMemoriesTool,
        getPersonMemory: getPersonMemoryTool,
        queryStateTool: queryStateTool,
        queryWorldMap: queryWorldMapTool,
      },
      stopWhen: stepCountIs(20),
    });

    logger.info("[message.llm.private] LLM 返回私聊回复", {
      sessionLabel: getProtocolMessageSenderName(message),
      text: result.text,
    });

    return result;
  }
}

// 导出默认实例
export const llmManager = new LLMManager();
