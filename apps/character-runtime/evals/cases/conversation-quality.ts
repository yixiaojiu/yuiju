import type { ConversationAgentEvent } from "../../src/communication";
import type { IncomingEvent, IncomingMessage } from "../../src/conversation/message";
import type { EvaluationCase } from "../report";

export const qualityTime = "2026-10-06T18:00:00+08:00";
export const quietEvening =
  "你在家里休息，刚吃完晚饭，正用手机看 QQ 群。身体状态良好，心情平静。今天没有尚待履行的约定。";
export const familiarEvening = `${quietEvening}\n小林是常来聊天的熟人，你们经常分享画画和吃饭的事。关系让你安心，但不是恋人。小夏和阿晴是普通群友。`;

/** 只提供已知事实与外部工具材料；不包含标准答案或行为断言。 */
export type ConversationQualityCase = EvaluationCase & {
  tags: string[];
  source: { kind: "adapted" | "constructed"; reference: string; changes: string };
  characterState: string;
  history: IncomingEvent[];
  inputs: { atSeconds: number; messages: IncomingEvent[]; agentEvents: ConversationAgentEvent[] }[];
  observeUntilSeconds: number;
  toolResults: {
    recall: string;
    people: Record<string, string>;
    media: Record<string, string>;
  };
};

/** 固定虚拟身份；这些称呼和 ID 同时用于正文中的 @ 与引用。 */
export const participants = {
  a: { senderId: "10001", senderName: "小林", isSelf: false },
  b: { senderId: "10002", senderName: "小夏", isSelf: false },
  c: { senderId: "10003", senderName: "阿晴", isSelf: false },
  bot: { senderId: "10004", senderName: "阿露", isSelf: false },
  self: { senderId: "90001", senderName: "悠乃", isSelf: true },
};

/** 构造真实消息结构；offsetSeconds 相对 qualityTime，不依赖测试执行时间。 */
export function chat(
  id: string,
  sender: keyof typeof participants,
  content: string,
  offsetSeconds: number,
  quote?: IncomingMessage["quote"],
): IncomingMessage {
  return {
    ...participants[sender],
    kind: "message",
    id,
    content,
    timestamp: new Date(qualityTime).getTime() + offsetSeconds * 1000,
    ...(quote ? { quote } : {}),
  };
}
