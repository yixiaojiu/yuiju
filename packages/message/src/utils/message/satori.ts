import type { h, Session } from "@satorijs/core";
import type { Message as SatoriMessage } from "@satorijs/protocol";
import { SUBJECT_NAME } from "@yuiju/utils";
import { stickerState, YUIJU_STICKER_ELEMENT_ATTR } from "@/state/sticker";
import { resolveSatoriImageDescription } from "./image";
import type {
  HistoryMessageSegment,
  HistoryReplySegment,
  StoredSatoriGroupMessage,
  StoredSatoriMessageSender,
  StoredSatoriPrivateMessage,
} from "./types";

const HISTORY_TEXT_SEGMENT_LIMIT = 300;
const HISTORY_TEXT_TRUNCATED_SUFFIX = "...[已截断]";
const ONEBOT_STICKER_IMAGE_SUBTYPE = "1";
const ONEBOT_STICKER_IMAGE_DESCRIPTION_PREFIX = "这是一个表情包，不是别人画给你的图。";

export async function createStoredSatoriGroupMessage(
  session: Session,
): Promise<StoredSatoriGroupMessage | null> {
  if (!session.channelId || session.isDirect || !session.event.message) {
    return null;
  }

  const elements = session.elements ?? [];
  if (!elements.length) {
    return null;
  }

  const channelId = session.channelId;
  const platform = session.platform || session.bot.platform || "unknown";
  const sender = await getSatoriSender(session);
  const sessionLabel = await getSatoriGroupSessionLabel(session, platform, channelId);

  return {
    source: "satori",
    scene: "group",
    platform,
    messageId: session.messageId || `${platform}:${channelId}:${session.id}`,
    channelId,
    guildId: session.guildId,
    sessionId: buildSatoriGroupSessionKey(platform, channelId),
    sessionLabel,
    sender,
    timestamp: session.timestamp || Date.now(),
    elements,
    content: await projectSatoriElementsToHistoryContent(elements, session),
    rawSession: session,
  };
}

export async function createStoredSatoriPrivateMessage(
  session: Session,
): Promise<StoredSatoriPrivateMessage | null> {
  if (!session.channelId || !session.isDirect || !session.event.message) {
    return null;
  }

  const elements = session.elements ?? [];
  if (!elements.length) {
    return null;
  }

  const channelId = session.channelId;
  const platform = session.platform || session.bot.platform || "unknown";
  const sender = await getSatoriSender(session);

  return {
    source: "satori",
    scene: "private",
    platform,
    messageId: session.messageId || `${platform}:${channelId}:${session.id}`,
    channelId,
    sessionId: buildSatoriPrivateSessionKey(platform, channelId),
    sessionLabel: sender.displayName,
    sender,
    timestamp: session.timestamp || Date.now(),
    elements,
    content: await projectSatoriElementsToHistoryContent(elements, session),
    rawSession: session,
  };
}

export async function createStoredSatoriGroupBotMessage(input: {
  sourceMessage: StoredSatoriGroupMessage;
  messageId: string;
  elements: h[];
  timestamp: number;
}): Promise<StoredSatoriGroupMessage> {
  return {
    source: "satori",
    scene: "group",
    platform: input.sourceMessage.platform,
    messageId: input.messageId,
    channelId: input.sourceMessage.channelId,
    guildId: input.sourceMessage.guildId,
    sessionId: input.sourceMessage.sessionId,
    sessionLabel: input.sourceMessage.sessionLabel,
    sender: {
      id: input.sourceMessage.rawSession?.selfId || input.sourceMessage.sender.id,
      displayName: SUBJECT_NAME,
      isSelf: true,
    },
    timestamp: input.timestamp,
    elements: input.elements,
    content: await projectSatoriElementsToHistoryContent(elementsWithoutQuote(input.elements)),
  };
}

export async function createStoredSatoriPrivateBotMessage(input: {
  sourceMessage: StoredSatoriPrivateMessage;
  messageId: string;
  elements: h[];
  timestamp: number;
}): Promise<StoredSatoriPrivateMessage> {
  return {
    source: "satori",
    scene: "private",
    platform: input.sourceMessage.platform,
    messageId: input.messageId,
    channelId: input.sourceMessage.channelId,
    sessionId: input.sourceMessage.sessionId,
    sessionLabel: input.sourceMessage.sessionLabel,
    sender: {
      id: input.sourceMessage.rawSession?.selfId || input.sourceMessage.sender.id,
      displayName: SUBJECT_NAME,
      isSelf: true,
    },
    timestamp: input.timestamp,
    elements: input.elements,
    content: await projectSatoriElementsToHistoryContent(elementsWithoutQuote(input.elements)),
  };
}

export function buildSatoriGroupSessionKey(platform: string, channelId: string): string {
  return `group:${platform}:${channelId}`;
}

export function buildSatoriPrivateSessionKey(platform: string, channelId: string): string {
  return `private:${platform}:${channelId}`;
}

/**
 * Satori elements 消息结构转换
 */
async function projectSatoriElementsToHistoryContent(
  elements: h[],
  session?: Session,
): Promise<HistoryMessageSegment[]> {
  const content: HistoryMessageSegment[] = [];
  const quoteContent = session ? await projectSatoriQuoteToHistoryContent(session) : null;
  if (quoteContent) {
    content.push(quoteContent);
  }

  for (const element of elementsWithoutQuote(elements)) {
    if (element.type === "text") {
      content.push({
        type: "text",
        data: {
          text: truncateHistoryTextSegment(String(element.attrs.content ?? "")),
        },
      } as HistoryMessageSegment);
      continue;
    }

    if (element.type === "at") {
      content.push({
        type: "at",
        data: {
          displayName: await getSatoriAtDisplayName(element, session),
        },
      });
      continue;
    }

    if (element.type === "image" || element.type === "img") {
      const stickerKey = String(element.attrs[YUIJU_STICKER_ELEMENT_ATTR] ?? "").trim();
      const sticker = stickerKey ? stickerState.getByKey(stickerKey) : null;
      if (sticker) {
        content.push({
          type: "sticker",
          data: {
            key: sticker.key,
            description: sticker.description,
          },
        });
        continue;
      }

      const description = await resolveSatoriImageDescription(element, session);
      const isOneBotStickerImage =
        String(element.attrs.subType ?? "").trim() === ONEBOT_STICKER_IMAGE_SUBTYPE;

      content.push({
        type: "image",
        data: {
          description: isOneBotStickerImage
            ? `${ONEBOT_STICKER_IMAGE_DESCRIPTION_PREFIX}${
                description ? `图片内容：${description}` : ""
              }`
            : description,
        },
      });
      continue;
    }

    if (element.type === "face") {
      content.push({
        type: "face",
        data: {
          faceText: String(element.attrs.name || element.attrs.id || ""),
        },
      });
      continue;
    }

    content.push(element);
  }

  return content;
}

function elementsWithoutQuote(elements: h[]): h[] {
  return elements.filter((element) => element.type !== "quote");
}

async function projectSatoriQuoteToHistoryContent(
  session: Session,
): Promise<HistoryReplySegment | null> {
  const quote = session.quote ?? session.event.message?.quote;
  if (!quote) {
    return null;
  }

  return {
    type: "reply",
    data: {
      speaker: getSatoriQuoteSpeaker(quote),
      content: await projectSatoriQuotedMessageContent(quote),
    },
  };
}

async function projectSatoriQuotedMessageContent(
  quote: SatoriMessage,
): Promise<HistoryMessageSegment[]> {
  if (quote.elements?.length) {
    return projectSatoriElementsToHistoryContent(elementsWithoutQuote(quote.elements));
  }

  const text = quote.content?.trim();
  if (!text) {
    return [];
  }

  return [
    {
      type: "text",
      data: {
        text: truncateHistoryTextSegment(text),
      },
    } as HistoryMessageSegment,
  ];
}

function truncateHistoryTextSegment(text: string): string {
  if (text.length <= HISTORY_TEXT_SEGMENT_LIMIT) {
    return text;
  }

  return `${text.slice(0, HISTORY_TEXT_SEGMENT_LIMIT)}${HISTORY_TEXT_TRUNCATED_SUFFIX}`;
}

function getSatoriQuoteSpeaker(quote: SatoriMessage): string | undefined {
  return quote.user?.name?.trim() || quote.user?.username?.trim() || quote.user?.id;
}

async function getSatoriSender(session: Session): Promise<StoredSatoriMessageSender> {
  const userId = session.userId || session.event.user?.id || "unknown";
  const userName =
    session.event.user?.name?.trim() ||
    session.event.user?.nick?.trim() ||
    session.event.user?.username?.trim();

  return {
    id: userId,
    displayName: userName || userId,
    isSelf: userId === session.selfId,
  };
}

async function getSatoriGroupSessionLabel(
  session: Session,
  platform: string,
  channelId: string,
): Promise<string> {
  const eventLabel =
    session.event.guild?.name?.trim() ||
    session.event.channel?.name?.trim() ||
    session.guildId ||
    channelId;

  if (platform !== "lark") {
    return eventLabel;
  }

  if (!session.guildId) {
    return eventLabel;
  }

  try {
    const guild = await session.bot.getGuild(session.guildId);
    return guild.name?.trim() || eventLabel;
  } catch {
    return eventLabel;
  }
}

async function getLarkGuildMemberDisplayName(
  session: Session,
  userId: string,
): Promise<string | null> {
  if (!session.guildId) {
    return null;
  }

  try {
    const members = await session.bot.getGuildMemberList(session.guildId);
    const member = members.data.find((item) => item.user?.id === userId);
    return member?.name?.trim() || member?.nick?.trim() || member?.user?.name?.trim() || null;
  } catch {
    return null;
  }
}

async function getSatoriAtDisplayName(element: h, session?: Session): Promise<string> {
  const attrs = element.attrs as Record<string, unknown>;
  if (attrs.type === "all") {
    return "全体成员";
  }

  const userId = String(attrs.id || "");
  if (!userId) {
    return String(attrs.name || "未知用户");
  }

  if (session?.selfId && userId === session.selfId) {
    return SUBJECT_NAME;
  }

  const name = typeof attrs.name === "string" ? attrs.name.trim() : "";
  if (name) {
    return name;
  }

  if (!session?.guildId) {
    return userId;
  }

  if (session.platform === "lark") {
    return (await getLarkGuildMemberDisplayName(session, userId)) || userId;
  }

  try {
    const member = await session.bot.getGuildMember(session.guildId, userId);
    return member.name?.trim() || member.nick?.trim() || member.user?.name?.trim() || userId;
  } catch {
    return userId;
  }
}
