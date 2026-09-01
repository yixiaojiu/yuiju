import type { Session } from "@satorijs/core";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { chatManager } from "@/chat/manager";
import { handleStoredSatoriChatMessage } from "@/chat/reply-strategy";
import { logger } from "@/utils/logger";
import { createStoredSatoriPrivateMessage, getProtocolMessageSenderName } from "@/utils/message";

const config = getYuijuConfig();

export async function privateMessageHandler(session: Session) {
  if (!session.isDirect) {
    return;
  }

  if (!session.content) {
    return;
  }

  const userId = session.userId || session.event.user?.id;
  if (!userId) {
    return;
  }

  if (session.platform === "onebot") {
    const qq = Number(userId);
    if (!Number.isInteger(qq) || !config.message.onebot.ownerList.includes(qq)) {
      return;
    }
  } else if (session.platform === "lark") {
    if (
      !config.message.lark.ownerList.includes(userId) &&
      !config.message.lark.whiteList.includes(userId)
    ) {
      return;
    }
  } else {
    return;
  }

  try {
    const storedMessage = await createStoredSatoriPrivateMessage(session);
    if (!storedMessage || storedMessage.sender.isSelf) {
      return;
    }

    const sessionLabel = getProtocolMessageSenderName(storedMessage);

    logger.info("[message.receive.private] 收到私聊消息", {
      platform: storedMessage.platform,
      sender: sessionLabel,
      messageId: storedMessage.messageId,
      content: storedMessage.content,
    });

    await chatManager.recordPrivateMessage(storedMessage, sessionLabel);

    await handleStoredSatoriChatMessage({ session, storedMessage });
  } catch (error) {
    logger.error("[message.reply.private] 处理私聊消息失败", error);
  }
}
