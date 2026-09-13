import type { AgentPlanChange } from "@yuiju/utils/types/plan";
import type { ModelMessage } from "ai";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export type PlannerReplyerChatAction =
  | {
      type: "reply";
      targetMessageId: string;
      setQuote: boolean;
      intention: string;
      expressionDirection: string;
      stickerIntent?: string;
    }
  | { type: "sendSticker" }
  | { type: "poke"; targetMessageId: string }
  | { type: "wait"; seconds: number }
  | { type: "none" };

export interface PlannerReplyerResult {
  action: PlannerReplyerChatAction;
  planChanges: AgentPlanChange[];
  turnMessages: ModelMessage[];
  maxInputTokens: number;
  internalNote: string;
}

export interface PlannerReplyerConversationRuntime {
  sessionId: string;
  pendingMessages: StoredSatoriGroupMessage[];
  running: boolean;
  forceTrigger: boolean;
  replyTaskVersion: number;
  replyController?: AbortController;
  consecutiveNoActionCount: number;
  backoffLevel: number;
  nextEligibleAt: number;
  consecutiveWaitCount: number;
}
