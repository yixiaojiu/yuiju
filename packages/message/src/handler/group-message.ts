import type { Session } from "@satorijs/core";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { chatManager } from "@/chat/manager";
import { handleStoredSatoriChatMessage } from "@/chat/reply-strategy";
import { logger } from "@/utils/logger";
import { createStoredSatoriGroupMessage } from "@/utils/message";

const config = getYuijuConfig();

export async function groupMessageHandler(session: Session) {
  const sessionGroupId = session.guildId ?? session.channelId;
  if (!sessionGroupId) {
    return;
  }

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

  const storedMessage = await createStoredSatoriGroupMessage(session);
  if (!storedMessage) {
    return;
  }
  if (storedMessage.sender.isSelf) {
    return;
  }

  logger.info("[message.receive.group] 收到群消息", {
    platform: storedMessage.platform,
    groupName: storedMessage.sessionLabel,
    sender: storedMessage.sender.displayName,
    messageId: storedMessage.messageId,
    content: storedMessage.content,
  });

  await chatManager.recordGroupMessage(storedMessage);

  await handleStoredSatoriChatMessage({ session, storedMessage });
}
