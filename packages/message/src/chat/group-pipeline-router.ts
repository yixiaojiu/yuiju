import type { Session } from "@satorijs/core";
import { ExperimentId, experimentManager } from "@yuiju/utils/experiment/experiment-manager";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";
import { plannerReplyerGroupChatManager } from "./planner-replyer/manager";
import { handleStoredSatoriChatMessage, handleStoredSatoriChatRecall } from "./reply-strategy";

export async function handleStoredSatoriGroupMessage(input: {
  session: Session;
  storedMessage: StoredSatoriGroupMessage;
}): Promise<void> {
  if (
    input.storedMessage.platform !== "onebot" ||
    !experimentManager.isEnabled(ExperimentId.PlannerReplyerChat)
  ) {
    await handleStoredSatoriChatMessage(input);
    return;
  }

  await plannerReplyerGroupChatManager.handleMessage(input);
}

export async function handleStoredSatoriGroupRecall(input: {
  session: Session;
  storedMessage: StoredSatoriGroupMessage & { recalledMessageId: string };
}): Promise<void> {
  if (
    input.storedMessage.platform !== "onebot" ||
    !experimentManager.isEnabled(ExperimentId.PlannerReplyerChat)
  ) {
    await handleStoredSatoriChatRecall(input);
    return;
  }

  await plannerReplyerGroupChatManager.handleMessage({ ...input, forceTrigger: true });
}
