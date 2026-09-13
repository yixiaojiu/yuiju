import type { ModelMessage } from "ai";
import { isDev } from "../env";
import { getRedis } from "./client";

export interface ChatPlannerTurn {
  realMessageIds: string[];
  messages: ModelMessage[];
  maxInputTokens: number;
}

export interface ChatPlannerSession {
  continuityMemo?: string;
  turns: ChatPlannerTurn[];
  lastProcessedMessageId?: string;
  updatedAt: number;
}

const REDIS_KEY = isDev()
  ? "dev:yuiju:message:chat-planner-session"
  : "yuiju:message:chat-planner-session";

export async function readChatPlannerSession(
  sessionId: string,
): Promise<ChatPlannerSession | null> {
  const value = await getRedis().hget(REDIS_KEY, sessionId);
  return value ? (JSON.parse(value) as ChatPlannerSession) : null;
}

export async function saveChatPlannerSession(
  sessionId: string,
  session: ChatPlannerSession,
): Promise<void> {
  await getRedis().hset(REDIS_KEY, sessionId, JSON.stringify(session));
}
