import type { MemoryEpisode } from "@yuiju/utils";
import { getTimeWithWeekday, SUBJECT_NAME } from "@yuiju/utils";
import dayjs from "dayjs";
import { getProtocolMessageSenderName, type StoredProtocolMessage } from "@/utils/message";

export interface ChatWindowMessageItem {
  speaker_name: string;
  content: string;
  timestamp: string;
}

export interface UserWindowState {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: StoredProtocolMessage[];
}

interface ConversationEpisodePayload {
  counterpartyName: string;
  windowStart: string;
  windowEnd: string;
  messageCount: number;
  messages: any[];
}

/**
 * 构建对话窗口 Episode。
 *
 * 说明：
 * - 窗口内部保存的是原始协议消息，归档时再统一投影为可读文本；
 * - payload 里仍保留稳定的展示结构，方便后续长期记忆和调试直接消费。
 */
export function buildConversationEpisode(input: {
  sessionLabel: string;
  state: UserWindowState;
  isDev: boolean;
  summaryText?: string;
}): MemoryEpisode<ConversationEpisodePayload> {
  const windowStart = new Date(input.state.windowStartMs);
  const windowEnd = new Date(input.state.lastTsMs);
  const windowStartText = getTimeWithWeekday(dayjs(windowStart));
  const windowEndText = getTimeWithWeekday(dayjs(windowEnd));
  const projectedMessages = input.state.messages.map((message) => ({
    speaker_name: getProtocolMessageSenderName(message),
    content: JSON.stringify(message.message),
    timestamp: getTimeWithWeekday(dayjs.unix(message.time)),
  }));
  const messageCount = projectedMessages.length;

  return {
    source: "chat",
    type: "conversation",
    subject: SUBJECT_NAME,
    happenedAt: windowEnd,
    summaryText: input.summaryText
      ? `时间范围：${windowStartText} 至 ${windowEndText}；对话摘要：${input.summaryText}`
      : [
          `${input.sessionLabel} 完成了一段对话窗口归档`,
          `时间范围：${windowStartText} 至 ${windowEndText}`,
          `消息数量：${messageCount}`,
        ].join("；"),
    isDev: input.isDev,
    payload: {
      counterpartyName: input.sessionLabel,
      windowStart: windowStartText,
      windowEnd: windowEndText,
      messageCount,
      messages: projectedMessages,
    },
  };
}
