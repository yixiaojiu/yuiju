import { setTimeout } from "node:timers/promises";
import type { Session } from "@satorijs/core";
import type { OneBotBot } from "@yuiju/satorijs-adapter-onebot";
import { ActionId, initCharacterStateData } from "@yuiju/utils";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { ExperimentId, experimentManager } from "@yuiju/utils/experiment/experiment-manager";
import { chatManager } from "@/chat/manager";
import { plannerReplyerGroupChatManager } from "@/chat/planner-replyer/manager";
import { logger } from "@/utils/logger";
import { createStoredSatoriGroupPokeMessage } from "@/utils/message/satori";

const MIN_POKE_REPLY_DELAY_MS = 2000;
const MAX_POKE_REPLY_DELAY_MS = 4000;

function getPokeReplyDelayMs(): number {
  return Math.round(
    MIN_POKE_REPLY_DELAY_MS + Math.random() * (MAX_POKE_REPLY_DELAY_MS - MIN_POKE_REPLY_DELAY_MS),
  );
}

export async function onebotPokeHandler(session: Session): Promise<void> {
  if (session.type !== "notice" || session.platform !== "onebot") {
    return;
  }

  const targetId = (session as any).targetId as string | undefined;
  if (targetId !== session.selfId) {
    return;
  }

  const userId = session.userId;
  if (!userId) {
    return;
  }

  if (session.guildId && experimentManager.isEnabled(ExperimentId.PlannerReplyerChat)) {
    const groupId = Number(session.guildId);
    if (
      !Number.isInteger(groupId) ||
      !getYuijuConfig().message.onebot.groupWhiteList.includes(groupId)
    ) {
      return;
    }

    const storedMessage = await createStoredSatoriGroupPokeMessage(session);
    await chatManager.recordGroupMessage(storedMessage);
    await plannerReplyerGroupChatManager.handleMessage({
      session,
      storedMessage,
      forceTrigger: true,
    });
    return;
  }

  const characterStateData = await initCharacterStateData();
  if (characterStateData.action === ActionId.Sleep) {
    return;
  }

  const delayMs = getPokeReplyDelayMs();

  logger.info("[message.poke] 收到 OneBot 戳一戳事件，准备回戳", {
    userId,
    targetId,
    guildId: session.guildId,
    channelId: session.channelId,
    delayMs,
  });

  await setTimeout(delayMs);

  const bot = session.bot as OneBotBot;
  if (session.guildId) {
    await bot.internal.groupPoke(session.guildId, userId);
  } else {
    await bot.internal.friendPoke(userId);
  }

  logger.info("[message.poke] 已发送 OneBot 回戳", {
    userId,
    guildId: session.guildId,
    channelId: session.channelId,
  });
}
