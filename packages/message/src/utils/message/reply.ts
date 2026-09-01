import { setTimeout } from "node:timers/promises";
import type { Session } from "@satorijs/core";
import { chatManager } from "@/chat/manager";
import { stickerState } from "@/state/sticker";
import { getReplyDelayMs } from "./delay";
import { createStoredSatoriGroupBotMessage, createStoredSatoriPrivateBotMessage } from "./satori";
import type { StoredSatoriGroupMessage, StoredSatoriPrivateMessage } from "./types";

/**
 * 发送并记录 Satori 私聊回复。
 */
export async function sendAndRecordSatoriPrivateReply(input: {
  session: Session;
  sourceMessage: StoredSatoriPrivateMessage;
  reply: string;
}) {
  if (!input.session.channelId) {
    return;
  }

  const replyLines = input.reply.split("\n").filter((line) => line.trim().length > 0);

  for (const [lineIndex, line] of replyLines.entries()) {
    const elements = stickerState.buildSatoriElementsFromLine(line);
    if (!elements.length) {
      continue;
    }

    const sentMessageIds = await input.session.bot.sendMessage(input.session.channelId, elements);
    const sentMessageId =
      sentMessageIds[0] ?? `${input.sourceMessage.messageId}:reply:${lineIndex}`;
    const storedSentMessage = await createStoredSatoriPrivateBotMessage({
      sourceMessage: input.sourceMessage,
      messageId: sentMessageId,
      elements,
      timestamp: Date.now(),
    });

    await chatManager.recordPrivateMessage(storedSentMessage);

    const nextLine = replyLines[lineIndex + 1];
    if (nextLine) {
      await setTimeout(getReplyDelayMs(nextLine));
    }
  }
}

/**
 * 发送并记录 Satori 群聊回复。
 */
export async function sendAndRecordSatoriGroupReply(input: {
  session: Session;
  sourceMessage: StoredSatoriGroupMessage;
  reply: string;
}) {
  if (!input.session.channelId) {
    return;
  }

  const replyLines = input.reply.split("\n").filter((line) => line.trim().length > 0);

  for (const [lineIndex, line] of replyLines.entries()) {
    const elements = stickerState.buildSatoriElementsFromLine(line);
    if (!elements.length) {
      continue;
    }

    const sentMessageIds = await input.session.bot.sendMessage(input.session.channelId, elements);
    const sentMessageId =
      sentMessageIds[0] ?? `${input.sourceMessage.messageId}:reply:${lineIndex}`;
    const storedSentMessage = await createStoredSatoriGroupBotMessage({
      sourceMessage: input.sourceMessage,
      messageId: sentMessageId,
      elements,
      timestamp: Date.now(),
    });

    await chatManager.recordGroupMessage(storedSentMessage);

    const nextLine = replyLines[lineIndex + 1];
    if (nextLine) {
      await setTimeout(getReplyDelayMs(nextLine));
    }
  }
}
