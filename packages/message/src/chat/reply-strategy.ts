import type { Session } from "@satorijs/core";
import { ExperimentId, experimentManager } from "@yuiju/utils/experiment/experiment-manager";
import { initCharacterStateData } from "@yuiju/utils/redis/state/character";
import { ActionId } from "@yuiju/utils/types/action";
import { logger } from "@/utils/logger";
import {
  sendAndRecordSatoriGroupReply,
  sendAndRecordSatoriPrivateReply,
} from "@/utils/message/reply";
import type { StoredSatoriChatMessage } from "@/utils/message/types";
import { chatManager } from "./manager";
import type { ChatResult } from "./types";

// 90秒
const NORMAL_CHAT_BATCH_WINDOW_MS = 90 * 1000;

interface SatoriBotIdentity {
  selfId?: string;
  config?: {
    appId?: string;
  };
}

export async function handleStoredSatoriChatMessage(input: {
  session: Session;
  storedMessage: StoredSatoriChatMessage;
}) {
  if (!experimentManager.isEnabled(ExperimentId.BatchedChatReply)) {
    await generateAndSendStoredChatReply(input, () => chatManager.chat(input.storedMessage));
    return;
  }

  if (isFastReplySignal(input.session)) {
    const closedReplyWindow = chatManager.closeReplyWindow(input.storedMessage);

    logger.info("[message.reply.strategy] 快速信号触发立即查看消息", {
      scene: input.storedMessage.scene,
      sessionId: input.storedMessage.sessionId,
      requestId: input.storedMessage.messageId,
      closedReplyWindow,
    });

    await generateAndSendStoredChatReply(input, () => chatManager.chat(input.storedMessage));
    return;
  }

  const startedReplyWindow = chatManager.startReplyWindow({
    message: input.storedMessage,
    delayMs: NORMAL_CHAT_BATCH_WINDOW_MS,
    onElapsed: (storedMessage) => {
      generateAndSendStoredChatReply(
        {
          session: input.session,
          storedMessage,
        },
        () => chatManager.chatBatch(storedMessage),
      );
    },
  });
  if (!startedReplyWindow) {
    logger.info("[message.reply.strategy] 普通消息加入待查看批次", {
      scene: input.storedMessage.scene,
      sessionId: input.storedMessage.sessionId,
      requestId: input.storedMessage.messageId,
    });
    return;
  }

  logger.info("[message.reply.strategy] 普通消息开始待查看批次", {
    scene: input.storedMessage.scene,
    sessionId: input.storedMessage.sessionId,
    requestId: input.storedMessage.messageId,
    delayMs: NORMAL_CHAT_BATCH_WINDOW_MS,
  });
}

export async function handleStoredSatoriChatRecall(input: {
  session: Session;
  storedMessage: StoredSatoriChatMessage & {
    recalledMessageId: string;
  };
}) {
  if (!experimentManager.isEnabled(ExperimentId.BatchedChatReply)) {
    await generateAndSendStoredChatReply(input, () => chatManager.chat(input.storedMessage));
    return;
  }

  if (chatManager.isReplyWindowOpen(input.storedMessage)) {
    logger.info("[message.reply.strategy] 待查看批次中的消息已撤回", {
      scene: input.storedMessage.scene,
      sessionId: input.storedMessage.sessionId,
      recalledMessageId: input.storedMessage.recalledMessageId,
      recallRequestId: input.storedMessage.messageId,
    });
    return;
  }

  await generateAndSendStoredChatReply(input, () => chatManager.chat(input.storedMessage));
}

async function generateAndSendStoredChatReply(
  input: {
    session: Session;
    storedMessage: StoredSatoriChatMessage;
  },
  generateChat: () => Promise<ChatResult>,
) {
  const { session, storedMessage } = input;

  try {
    if (storedMessage.scene === "group") {
      const characterStateData = await initCharacterStateData();
      if (characterStateData.action === ActionId.Sleep) {
        return;
      }
    }

    const chatResult = await generateChat();
    if (chatResult.status === "cancelled") {
      logger.info(`[message.reply.${storedMessage.scene}] 回复生成已取消，不发送消息`, {
        sessionId: storedMessage.sessionId,
        sessionLabel: storedMessage.sessionLabel,
        requestId: storedMessage.messageId,
      });
      return;
    }
    if (chatResult.status === "failed") {
      return;
    }

    if (!chatManager.isLatestChatRequest(storedMessage.sessionId, chatResult.requestId)) {
      logger.info(`[message.reply.${storedMessage.scene}] 回复结果已过期，不发送消息`, {
        sessionId: storedMessage.sessionId,
        sessionLabel: storedMessage.sessionLabel,
        requestId: chatResult.requestId,
      });
      return;
    }

    if (!chatResult.shouldReply) {
      logger.info(`[message.reply.${storedMessage.scene}] 不回复`, {
        sessionId: storedMessage.sessionId,
        sessionLabel: storedMessage.sessionLabel,
        requestId: chatResult.requestId,
        reason: chatResult.noReplyReason || "未提供原因",
      });
      return;
    }

    const reply = chatResult.reply.trim();
    if (!reply) {
      return;
    }

    if (storedMessage.scene === "group") {
      await sendAndRecordSatoriGroupReply({
        session,
        sourceMessage: storedMessage,
        reply,
      });
      return;
    }

    await sendAndRecordSatoriPrivateReply({
      session,
      sourceMessage: storedMessage,
      reply,
    });
  } catch (error) {
    logger.error(`[message.reply.${storedMessage.scene}] 处理消息失败`, error);
  }
}

function isFastReplySignal(session: Session): boolean {
  if (
    session.type === "notice" &&
    (session as Session & { targetId?: string }).targetId === session.selfId
  ) {
    return true;
  }

  const bot = session.bot as SatoriBotIdentity;
  const selfIds = new Set(
    [session.selfId, bot.selfId, bot.config?.appId].filter(
      (selfId): selfId is string => typeof selfId === "string" && selfId.length > 0,
    ),
  );
  const quote = session.quote ?? session.event.message?.quote;
  if (quote?.user?.id && selfIds.has(quote.user.id)) {
    return true;
  }

  return (session.elements ?? []).some(
    (element) => element.type === "at" && selfIds.has(String(element.attrs.id)),
  );
}
