import {
  type ChatPlannerSession,
  type ChatPlannerTurn,
  readChatPlannerSession,
  saveChatPlannerSession,
} from "@yuiju/utils/redis/chat-planner-session";
import type { ModelMessage } from "ai";

export async function getChatPlannerSession(sessionId: string): Promise<ChatPlannerSession> {
  return (
    (await readChatPlannerSession(sessionId)) ?? {
      turns: [],
      updatedAt: Date.now(),
    }
  );
}

export function buildChatPlannerHistory(session: ChatPlannerSession): ModelMessage[] {
  const messages: ModelMessage[] = [];
  if (session.continuityMemo) {
    messages.push({
      role: "user",
      content: `【此前的连续性备忘】\n${session.continuityMemo}`,
    });
  }

  for (const turn of session.turns) {
    messages.push(...turn.messages);
  }
  return messages;
}

export async function appendPlannerTurn(input: {
  sessionId: string;
  realMessageIds: string[];
  messages: ModelMessage[];
  maxInputTokens: number;
}): Promise<void> {
  const session = await getChatPlannerSession(input.sessionId);
  const turn: ChatPlannerTurn = {
    realMessageIds: input.realMessageIds,
    messages: input.messages,
    maxInputTokens: input.maxInputTokens,
  };
  session.turns.push(turn);
  session.updatedAt = Date.now();
  await saveChatPlannerSession(input.sessionId, session);
}

export async function appendPlannerOutcome(sessionId: string, outcome: string): Promise<void> {
  const session = await getChatPlannerSession(sessionId);
  const turn = session.turns.at(-1)!;
  turn.messages.push({ role: "user", content: `【行动结果】\n${outcome}` });
  session.updatedAt = Date.now();
  await saveChatPlannerSession(sessionId, session);
}

export async function markPlannerMessagesProcessed(
  sessionId: string,
  lastProcessedMessageId: string,
): Promise<void> {
  const session = await getChatPlannerSession(sessionId);
  session.lastProcessedMessageId = lastProcessedMessageId;
  session.updatedAt = Date.now();
  await saveChatPlannerSession(sessionId, session);
}
