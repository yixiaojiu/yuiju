import type { Session } from "@satorijs/core";
import type { OneBotBot } from "@yuiju/satorijs-adapter-onebot";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export async function sendChatPoke(input: {
  session: Session;
  targetMessageId: string;
  recentMessages: readonly StoredSatoriGroupMessage[];
}): Promise<void> {
  const targetMessage = input.recentMessages.find(
    (message) => message.messageId === input.targetMessageId,
  );
  if (!targetMessage) {
    throw new Error(`找不到戳一戳目标消息：${input.targetMessageId}`);
  }
  if (targetMessage.sender.isSelf) {
    throw new Error("不能把自己作为戳一戳目标");
  }

  const bot = input.session.bot as OneBotBot;
  await bot.internal.groupPoke(input.session.guildId!, targetMessage.sender.id);
}
