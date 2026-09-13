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
    public readonly firstSendCompletedAt: number | undefined,
    public readonly platformSendDurationMs: number,
    public readonly segmentDelayDurationMs: number,
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
}): Promise<{
  sentCount: number;
  complete: boolean;
  firstSendCompletedAt?: number;
  platformSendDurationMs: number;
  segmentDelayDurationMs: number;
}> {
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
  let firstSendCompletedAt: number | undefined;
  let platformSendDurationMs = 0;
  let segmentDelayDurationMs = 0;
  for (const [index, segment] of segments.entries()) {
    if (input.abortSignal.aborted) {
      break;
    }

    const sendStartedAt = Date.now();
    let sendCompleted = false;
    try {
      const timestamp = Date.now();
      const sentMessageIds = await input.session.bot.sendMessage(
        input.sourceMessage.channelId,
        segment.elements,
      );
      platformSendDurationMs += Date.now() - sendStartedAt;
      sendCompleted = true;
      sentCount += 1;
      firstSendCompletedAt ??= Date.now();
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
      if (!sendCompleted) {
        platformSendDurationMs += Date.now() - sendStartedAt;
      }
      throw new PlannerReplyerPartialSendError(
        "Planner-Replyer 聊天消息分段发送失败",
        sentCount,
        firstSendCompletedAt,
        platformSendDurationMs,
        segmentDelayDurationMs,
        { cause: error },
      );
    }

    const nextSegment = segments[index + 1];
    if (!nextSegment) {
      continue;
    }

    const delayStartedAt = Date.now();
    try {
      await setTimeout(getReplyDelayMs(nextSegment.delayText), undefined, {
        signal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal.aborted) {
        break;
      }
      throw error;
    } finally {
      segmentDelayDurationMs += Date.now() - delayStartedAt;
    }
  }

  return {
    sentCount,
    complete: sentCount === segments.length,
    firstSendCompletedAt,
    platformSendDurationMs,
    segmentDelayDurationMs,
  };
}
