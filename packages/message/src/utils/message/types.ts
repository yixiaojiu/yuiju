import type { h, Session } from "@satorijs/core";

export interface StoredSatoriMessageSender {
  id: string;
  displayName: string;
  isSelf: boolean;
}

export interface StoredSatoriGroupMessage {
  source: "satori";
  scene: "group";
  platform: string;
  messageId: string;
  channelId: string;
  guildId?: string;
  sessionId: string;
  sessionLabel: string;
  sender: StoredSatoriMessageSender;
  timestamp: number;
  elements: h[];
  content: HistoryMessageSegment[];
  rawSession?: Session;
}

export interface StoredSatoriPrivateMessage {
  source: "satori";
  scene: "private";
  platform: string;
  messageId: string;
  channelId: string;
  sessionId: string;
  sessionLabel: string;
  sender: StoredSatoriMessageSender;
  timestamp: number;
  elements: h[];
  content: HistoryMessageSegment[];
  rawSession?: Session;
}

export type StoredSatoriChatMessage = StoredSatoriGroupMessage | StoredSatoriPrivateMessage;

export interface HistoryTextSegment {
  type: "text";
  data: {
    text: string;
  };
}

export interface HistoryReplySegment {
  type: "reply";
  data: {
    speaker?: string;
    content: HistoryMessageSegment[];
  };
}

export interface HistoryAtSegment {
  type: "at";
  data: {
    displayName: string;
  };
}

export interface HistoryImageSegment {
  type: "image";
  data: {
    description?: string;
  };
}

export interface HistoryFaceSegment {
  type: "face";
  data: {
    faceText?: string;
  };
}

export type HistoryMessageSegment =
  | HistoryTextSegment
  | HistoryImageSegment
  | HistoryAtSegment
  | HistoryReplySegment
  | HistoryFaceSegment
  | h;

export interface HistoryMessageItem {
  speaker: string;
  time: string;
  content: HistoryMessageSegment[];
}

/**
 * 供 LLM 消费的结构化历史项。
 *
 * 说明：
 * - 这里只描述真实消息，不再混入滚动摘要；
 * - 摘要会由上层 prompt 以独立文本章节注入。
 */
export type HistoryJsonItem = HistoryMessageItem;
