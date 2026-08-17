import type { MemoryEpisode } from "@yuiju/utils";
import { getTimeWithWeekday, SUBJECT_NAME } from "@yuiju/utils";
import dayjs from "dayjs";
import {
  getProtocolMessageSenderName,
  getProtocolMessageTimestampMs,
  projectStoredMessageContent,
  type StoredSatoriChatMessage,
} from "@/utils/message";

export interface ChatWindowMessageItem {
  speaker_name: string;
  content: string;
  timestamp: string;
}

export interface ChatMoodChange {
  delta: number;
}

export interface UserWindowState {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: StoredSatoriChatMessage[];
  moodChanges: ChatMoodChange[];
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
    content: JSON.stringify(projectStoredMessageContent(message)),
    timestamp: getTimeWithWeekday(dayjs(getProtocolMessageTimestampMs(message))),
  }));
  const messageCount = projectedMessages.length;
  const moodDeltaTotal = input.state.moodChanges.reduce((total, change) => total + change.delta, 0);
  const moodSummaryText =
    input.state.moodChanges.length > 0
      ? `心情变化：本窗口聊天让心情总共变化 ${moodDeltaTotal > 0 ? `+${moodDeltaTotal}` : moodDeltaTotal}`
      : null;
  const summaryParts = input.summaryText
    ? [`时间范围：${windowStartText} 至 ${windowEndText}`, `对话摘要：${input.summaryText}`]
    : [
        `${input.sessionLabel} 完成了一段对话窗口归档`,
        `时间范围：${windowStartText} 至 ${windowEndText}`,
        `消息数量：${messageCount}`,
      ];
  if (moodSummaryText) {
    summaryParts.push(moodSummaryText);
  }

  return {
    source: "chat",
    type: "conversation",
    subject: SUBJECT_NAME,
    happenedAt: windowEnd,
    summaryText: summaryParts.join("；"),
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

/**
 * 判断今天是否还需要更新人物记忆。
 *
 * 说明：
 * - 人物记忆更新过于频繁会放大 LLM 调用成本，因此限制为每天最多更新一次；
 * - `lastUpdatedMs` 为空表示从未更新过，需要立即更新；
 * - 与今天不是同一天时才允许再次更新。
 */
export function shouldUpdatePersonMemoryToday(
  lastUpdatedMs: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (!lastUpdatedMs) {
    return true;
  }

  return !dayjs(lastUpdatedMs).isSame(dayjs(nowMs), "day");
}
