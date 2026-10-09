import { h } from "@satorijs/core";
import { formatLlmDateTime } from "@yuiju/shared/date/format";

export type ConversationScope = { characterId: string; platform: "onebot"; channelId: string };
export type ConversationMessage = {
  // 会话内收发事件的顺序，与平台消息 id 不同；戳一戳、撤回也有 sequence。
  sequence: number;
  senderId: string;
  senderName: string;
  timestamp: number;
  isSelf: boolean;
} & (
  | {
      kind: "message";
      id: string;
      // XHTML 正文保留媒体与 @ 的语义，引用信息单独存储。
      content: string;
      quote?: { id: string; content?: string; senderId?: string; senderName?: string };
      mentionedSenderId?: string;
    }
  | { kind: "poke"; targetSenderId: string }
  | {
      kind: "recall";
      recalledMessageId: string;
      /** 实际执行撤回的人；senderId 仍是原消息的发送者。 */
      operatorId: string;
    }
);
export type IncomingMessage = Omit<Extract<ConversationMessage, { kind: "message" }>, "sequence">;
export type IncomingPoke = Omit<Extract<ConversationMessage, { kind: "poke" }>, "sequence">;
export type IncomingRecall = Omit<Extract<ConversationMessage, { kind: "recall" }>, "sequence">;

/** 提取触发判断使用的可见文字，不把媒体 URL、用户 ID 等属性当作发言内容。 */
export function visibleText(content: string): string {
  const elements = h.parse(content);
  const texts: string[] = [];
  const visit = (nodes: h[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        texts.push(node.attrs.content);
      } else {
        visit(node.children);
      }
    }
  };
  visit(elements);
  return texts.join("");
}

/**
 * 将聊天事件渲染为 XHTML，身份信息放在属性中，引用与正文作为子元素。
 * Satori 将属性名转为连字符形式；只使用事件发生时间，重复渲染保持稳定。
 * @param message 实际收到或发送的事件。
 * @param timezone 项目配置的 app.timezone，用于展示事件发生时间。
 */
export function renderMessage(message: IncomingEvent, timezone: string): string {
  const identity = {
    senderId: message.senderId,
    senderName: message.senderName,
    time: formatLlmDateTime(message.timestamp, timezone),
    // 使用字符串保留明确的 true / false，避免被序列化为 is-self / no-is-self。
    isSelf: String(message.isSelf),
  };
  if (message.kind === "poke") {
    return h("poke", { ...identity, targetSenderId: message.targetSenderId }).toString();
  }
  if (message.kind === "recall") {
    return h(
      "recall",
      { ...identity, recalledMessageId: message.recalledMessageId, operatorId: message.operatorId },
      message.operatorId === message.senderId ? "撤回了一条消息" : "该发送者的一条消息被管理员撤回",
    ).toString();
  }

  const children: h[] = [];
  if (message.quote) {
    const { id, senderId, senderName, content } = message.quote;
    children.push(
      h("quote", { id, senderId, senderName }, content === undefined ? [] : h.parse(content)),
    );
  }
  children.push(...h.parse(message.content));
  return h("message", { id: message.id, ...identity }, children).toString();
}

export type IncomingEvent = IncomingMessage | IncomingPoke | IncomingRecall;
export type ReplyTarget = { quoteMessageId?: string; senderId?: string };
