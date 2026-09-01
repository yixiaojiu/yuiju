import { setTimeout } from "node:timers/promises";
import { serve } from "@hono/node-server";
import type LarkBot from "@satorijs/adapter-lark";
import type OneBotBot from "@yuiju/satorijs-adapter-onebot";
import { SUBJECT_NAME } from "@yuiju/utils";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { webChatHistoryQuerySchema, webChatMessageInputSchema } from "@yuiju/utils/types/web-chat";
import { Hono } from "hono";
import { chatManager } from "@/chat/manager";
import { stickerState } from "@/state/sticker";
import { logger } from "@/utils/logger";
import { getReplyDelayMs } from "@/utils/message";
import {
  buildSatoriGroupSessionKey,
  createStoredSatoriGroupBotMessage,
} from "@/utils/message/satori";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";
import { chatThroughWebChannel, getWebChatHistory, getWebChatSticker } from "@/web-chat";

type MessagePlatform = "onebot" | "lark";

interface InternalApiInput {
  onebot: OneBotBot;
  lark: LarkBot;
}

function getPlatformBot(input: InternalApiInput, platform: MessagePlatform) {
  return platform === "onebot" ? input.onebot : input.lark;
}

async function getGroupLabel(input: {
  onebot: OneBotBot;
  lark: LarkBot;
  platform: MessagePlatform;
  groupId: string;
}): Promise<string> {
  if (input.platform === "onebot") {
    const group = await input.onebot.getGuild(input.groupId);
    return group.name || input.groupId;
  }

  const channel = await input.lark.getChannel(input.groupId);
  return channel.name || input.groupId;
}

function buildInternalSourceMessage(input: {
  platform: MessagePlatform;
  groupId: string;
  sessionLabel: string;
  selfId: string;
}): StoredSatoriGroupMessage {
  return {
    source: "satori",
    scene: "group",
    platform: input.platform,
    messageId: `internal-api:${input.platform}:${input.groupId}`,
    channelId: input.groupId,
    guildId: input.groupId,
    sessionId: buildSatoriGroupSessionKey(input.platform, input.groupId),
    sessionLabel: input.sessionLabel,
    sender: {
      id: input.selfId,
      displayName: SUBJECT_NAME,
      isSelf: true,
    },
    timestamp: Date.now(),
    elements: [],
    content: [],
  };
}

export function startMessageInternalApi(input: InternalApiInput) {
  const app = new Hono();
  const config = getYuijuConfig();

  app.get("/internal/stickers", (context) => {
    return context.json({
      promptSection: stickerState.getPromptSection(),
      stickers: stickerState.list().map((sticker) => ({
        key: sticker.key,
        description: sticker.description,
      })),
    });
  });

  app.post("/internal/web/messages", async (context) => {
    if (!config.message.web.enabled) {
      return context.json({ error: { code: "WEB_CHAT_DISABLED" } }, 403);
    }

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: { code: "INVALID_WEB_CHAT_MESSAGE" } }, 400);
    }

    const parsedMessage = webChatMessageInputSchema.safeParse(body);
    if (!parsedMessage.success) {
      return context.json({ error: { code: "INVALID_WEB_CHAT_MESSAGE" } }, 400);
    }

    const result = await chatThroughWebChannel(parsedMessage.data);
    return context.json(result);
  });

  app.get("/internal/web/messages", async (context) => {
    if (!config.message.web.enabled) {
      return context.json({ error: { code: "WEB_CHAT_DISABLED" } }, 403);
    }

    const cursorSentAt = context.req.query("cursorSentAt");
    const cursorId = context.req.query("cursorId");
    const parsedQuery = webChatHistoryQuerySchema.safeParse({
      limit: Number(context.req.query("limit")),
      cursor:
        cursorSentAt === undefined && cursorId === undefined
          ? undefined
          : { sentAt: Number(cursorSentAt), id: cursorId },
    });
    if (!parsedQuery.success) {
      return context.json({ error: { code: "INVALID_WEB_CHAT_HISTORY_QUERY" } }, 400);
    }

    return context.json(await getWebChatHistory(parsedQuery.data));
  });

  app.get("/internal/web/stickers/:key", (context) => {
    if (!config.message.web.enabled) {
      return context.json({ error: { code: "WEB_CHAT_DISABLED" } }, 403);
    }

    const sticker = getWebChatSticker(context.req.param("key"));
    if (!sticker) {
      return context.body(null, 404);
    }

    return context.body(new Uint8Array(sticker.fileBuffer), 200, {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": sticker.contentType,
    });
  });

  app.get("/internal/:platform/groups/:groupId/context", async (context) => {
    const platform = context.req.param("platform") as MessagePlatform;
    if (platform !== "onebot" && platform !== "lark") {
      return context.json({ message: "unsupported platform" }, 400);
    }

    const groupId = context.req.param("groupId");
    const limit = Number(context.req.query("limit") ?? 20);
    const groupLabel = await getGroupLabel({
      onebot: input.onebot,
      lark: input.lark,
      platform,
      groupId,
    });
    const groupContext = chatManager.groupSession.getHistoryJson(
      buildSatoriGroupSessionKey(platform, groupId),
      { limit },
    );

    return context.json({
      platform,
      groupId,
      groupLabel,
      summary: groupContext.summary,
      historyJson: groupContext.historyJson,
    });
  });

  app.post("/internal/:platform/groups/:groupId/messages", async (context) => {
    const platform = context.req.param("platform") as MessagePlatform;
    if (platform !== "onebot" && platform !== "lark") {
      return context.json({ message: "unsupported platform" }, 400);
    }

    const groupId = context.req.param("groupId");
    const body = await context.req.json<{ message: string }>();
    const message = body.message.trim();
    const groupLabel = await getGroupLabel({
      onebot: input.onebot,
      lark: input.lark,
      platform,
      groupId,
    });
    const bot = getPlatformBot(input, platform);
    const sourceMessage = buildInternalSourceMessage({
      platform,
      groupId,
      sessionLabel: groupLabel,
      selfId: bot.selfId || bot.user?.id || platform,
    });
    const replyLines = message.split("\n").filter((line) => line.trim().length > 0);
    const sentMessageIds: string[] = [];

    for (const [lineIndex, line] of replyLines.entries()) {
      const elements = stickerState.buildSatoriElementsFromLine(line);
      if (!elements.length) {
        continue;
      }

      const currentTimestamp = Date.now();
      const currentSentMessageIds = await bot.sendMessage(groupId, elements);
      const sentMessageId =
        currentSentMessageIds[0] ??
        `internal:${platform}:${groupId}:${currentTimestamp}:${lineIndex}`;

      sentMessageIds.push(...currentSentMessageIds);

      const storedSentMessage = await createStoredSatoriGroupBotMessage({
        sourceMessage,
        messageId: sentMessageId,
        elements,
        timestamp: currentTimestamp,
      });
      await chatManager.recordGroupMessage(storedSentMessage);

      const nextLine = replyLines[lineIndex + 1];
      if (nextLine) {
        await setTimeout(getReplyDelayMs(nextLine));
      }
    }

    return context.json({ sentMessageIds });
  });

  return serve(
    {
      fetch: app.fetch,
      hostname: config.message.internalApi.host,
      port: config.message.internalApi.port,
    },
    (info) => {
      logger.info("[message.internal-api] 内部 HTTP 服务启动完成", {
        address: info.address,
        port: info.port,
      });
    },
  );
}
