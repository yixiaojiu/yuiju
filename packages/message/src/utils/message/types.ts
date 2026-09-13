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
  origin?: "planner-replyer";
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

export interface HistoryRecallSegment {
  type: "recall";
  data: {
    text: "撤回了一条消息";
  };
}

/**
 * 用原消息的会话与发送者信息记录撤回事实，同时移除已经失效的原消息内容。
 */
export type StoredSatoriRecallMessage<TMessage extends StoredSatoriChatMessage> = TMessage & {
  recordType: "recall";
  recalledMessageId: string;
  elements: [];
  content: [HistoryRecallSegment];
};

export interface HistoryTextSegment {
  type: "text";
  data: {
    text: string;
  };
}

export interface HistoryReplySegment {
  type: "reply";
  data: {
    messageId?: string;
    senderId?: string;
    speaker?: string;
    content: HistoryMessageSegment[];
  };
}

export interface HistoryPokeSegment {
  type: "poke";
  data: {
    text: "戳了戳悠酱";
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
  | HistoryPokeSegment
  | HistoryFaceSegment
  | HistoryRecallSegment
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
