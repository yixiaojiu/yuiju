import type { Session } from "@satorijs/core";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { chatManager } from "@/chat/manager";
import { handleStoredSatoriChatRecall } from "@/chat/reply-strategy";
import { logger } from "@/utils/logger";

const config = getYuijuConfig();

export async function messageRecallHandler(session: Session) {
  try {
    if (!session.channelId || !session.messageId) {
      return;
    }

    if (session.subtype === "private") {
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

      const recallMessage = await chatManager.recordPrivateMessageRecall({
        platform: session.platform,
        channelId: session.channelId,
        messageId: session.messageId,
        timestamp: Date.now(),
      });
      if (!recallMessage) {
        return;
      }

      logger.info("[message.recall.private] 已记录私聊消息撤回，重新生成回复", {
        platform: session.platform,
        userId,
        messageId: session.messageId,
        recallRequestId: recallMessage.messageId,
      });

      await handleStoredSatoriChatRecall({ session, storedMessage: recallMessage });
      return;
    }

    if (session.subtype !== "group") {
      return;
    }

    const sessionGroupId = session.guildId ?? session.channelId;
    if (session.platform === "onebot") {
      const groupId = Number(sessionGroupId);
      if (!Number.isInteger(groupId) || !config.message.onebot.groupWhiteList.includes(groupId)) {
        return;
      }
    } else if (session.platform === "lark") {
      if (!config.message.lark.groupWhiteList.includes(sessionGroupId)) {
        return;
      }
    } else {
      return;
    }

    const recallMessage = await chatManager.recordGroupMessageRecall({
      platform: session.platform,
      channelId: session.channelId,
      messageId: session.messageId,
      timestamp: Date.now(),
    });
    if (!recallMessage) {
      return;
    }

    logger.info("[message.recall.group] 已记录群聊消息撤回，重新生成回复", {
      platform: session.platform,
      groupId: sessionGroupId,
      messageId: session.messageId,
      recallRequestId: recallMessage.messageId,
    });

    await handleStoredSatoriChatRecall({ session, storedMessage: recallMessage });
  } catch (error) {
    logger.error("[message.recall] 处理消息撤回事件失败", error);
  }
}
