import { setTimeout } from "node:timers/promises";
import { h, type Session } from "@satorijs/core";
import { chatManager } from "@/chat/manager";
import { stickerState } from "@/state/sticker";
import { getReplyDelayMs } from "@/utils/message/delay";
import { createStoredSatoriGroupBotMessage } from "@/utils/message/satori";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export class PlannerReplyerPartialSendError extends Error {
  constructor(
    message: string,
    public readonly sentCount: number,
    options: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlannerReplyerPartialSendError";
  }
}

export async function sendChatSegments(input: {
  session: Session;
  sourceMessage: StoredSatoriGroupMessage;
  textSegments: string[];
  stickerKey?: string;
  quoteMessageId?: string;
  abortSignal: AbortSignal;
}): Promise<{ sentCount: number; complete: boolean }> {
  const segments = input.textSegments.map((text, index) => ({
    elements:
      index === 0 && input.quoteMessageId
        ? [h("quote", { id: input.quoteMessageId }), h.text(text)]
        : [h.text(text)],
    delayText: text,
  }));
  if (input.stickerKey) {
    segments.push({
      elements: stickerState.buildSatoriElementsFromLine(`[[sticker:${input.stickerKey}]]`),
      delayText: "表情包",
    });
  }

  let sentCount = 0;
  for (const [index, segment] of segments.entries()) {
    if (input.abortSignal.aborted) {
      break;
    }

    try {
      const timestamp = Date.now();
      const sentMessageIds = await input.session.bot.sendMessage(
        input.sourceMessage.channelId,
        segment.elements,
      );
      sentCount += 1;
      const storedMessage = await createStoredSatoriGroupBotMessage({
        sourceMessage: input.sourceMessage,
        selfId: input.session.selfId,
        messageId:
          sentMessageIds[0] ?? `${input.sourceMessage.messageId}:planner-replyer-reply:${index}`,
        elements: segment.elements,
        timestamp,
        origin: "planner-replyer",
      });
      await chatManager.recordGroupMessage(storedMessage);
    } catch (error) {
      throw new PlannerReplyerPartialSendError("Planner-Replyer 聊天消息分段发送失败", sentCount, {
        cause: error,
      });
    }

    const nextSegment = segments[index + 1];
    if (!nextSegment) {
      continue;
    }

    try {
      await setTimeout(getReplyDelayMs(nextSegment.delayText), undefined, {
        signal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal.aborted) {
        break;
      }
      throw error;
    }
  }

  return { sentCount, complete: sentCount === segments.length };
}
