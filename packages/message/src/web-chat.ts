import { extname } from "node:path";
import { h } from "@satorijs/core";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { SUBJECT_NAME } from "@yuiju/utils/constants/character";
import {
  beginWebChatMessage,
  completeWebChatMessage,
  getWebChatMessagesPage,
  matchesWebChatMessageInput,
  projectStoredWebChatResult,
} from "@yuiju/utils/db/operations/web-chat-message";
import type {
  WebChatHistoryMessage,
  WebChatHistoryPage,
  WebChatHistoryQuery,
  WebChatMessageInput,
  WebChatReplyPart,
  WebChatResult,
} from "@yuiju/utils/types/web-chat";
import { chatManager } from "@/chat/manager";
import { stickerState } from "@/state/sticker";
import { buildSatoriPrivateSessionKey } from "@/utils/message/satori";
import type { HistoryMessageSegment, StoredSatoriPrivateMessage } from "@/utils/message/types";

function createWebPrivateMessage(input: WebChatMessageInput): StoredSatoriPrivateMessage {
  const { ownerId, ownerName } = getYuijuConfig().message.web;

  return {
    source: "satori",
    scene: "private",
    platform: "web",
    messageId: input.messageId,
    channelId: ownerId,
    sessionId: buildSatoriPrivateSessionKey("web", ownerId),
    sessionLabel: ownerName,
    sender: {
      id: ownerId,
      displayName: ownerName,
      isSelf: false,
    },
    timestamp: input.sentAt,
    elements: [h.text(input.text)],
    content: [{ type: "text", data: { text: input.text } }],
  };
}

function projectWebReplyContent(elements: h[]): HistoryMessageSegment[] {
  return elements.map((element) => {
    if (element.type === "text") {
      return { type: "text", data: { text: String(element.attrs.content ?? "") } };
    }

    const sticker = stickerState.getByKey(String(element.attrs.summary ?? ""));
    return {
      type: "image",
      data: { description: sticker?.description },
    };
  });
}

function appendWebReplyParts(parts: WebChatReplyPart[], elements: h[], needsLineBreak: boolean) {
  if (needsLineBreak && elements.length > 0) {
    parts.push({ type: "text", text: "\n" });
  }

  for (const element of elements) {
    if (element.type === "text") {
      parts.push({ type: "text", text: String(element.attrs.content ?? "") });
      continue;
    }

    if (element.type === "image") {
      const key = String(element.attrs.summary ?? "");
      parts.push({
        type: "sticker",
        key,
        url: `/api/chat/stickers/${encodeURIComponent(key)}`,
      });
    }
  }
}

export async function chatThroughWebChannel(input: WebChatMessageInput): Promise<WebChatResult> {
  const sourceMessage = createWebPrivateMessage(input);
  const writeInput = {
    sessionId: sourceMessage.sessionId,
    messageId: input.messageId,
    sender: {
      id: sourceMessage.sender.id,
      displayName: sourceMessage.sender.displayName,
    },
    text: input.text,
    sentAt: input.sentAt,
  };
  const beginResult = await beginWebChatMessage(writeInput);
  if (beginResult.status === "existing") {
    if (!matchesWebChatMessageInput(beginResult.message, writeInput)) {
      return { status: "message-conflict" };
    }
    return projectStoredWebChatResult(beginResult.message);
  }

  let result: Awaited<ReturnType<typeof chatManager.chat>>;
  try {
    await chatManager.recordPrivateMessage(sourceMessage);
    result = await chatManager.chat(sourceMessage);
  } catch (error) {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, { status: "failed" });
    throw error;
  }

  if (result.status === "cancelled") {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, {
      status: "superseded",
    });
    return { status: "superseded" };
  }
  if (result.status === "failed") {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, { status: "failed" });
    return { status: "failed" };
  }
  if (!chatManager.isLatestChatRequest(sourceMessage.sessionId, result.requestId)) {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, {
      status: "superseded",
    });
    return { status: "superseded" };
  }
  if (!result.shouldReply || !result.reply.trim()) {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, { status: "no-reply" });
    return { status: "no-reply" };
  }

  const parts: WebChatReplyPart[] = [];
  const replyLines = result.reply.split("\n").filter((line) => line.trim().length > 0);
  const createdAt = Date.now();

  try {
    for (const [lineIndex, line] of replyLines.entries()) {
      const elements = stickerState.buildSatoriElementsFromLine(line);
      if (!elements.length) {
        continue;
      }

      appendWebReplyParts(parts, elements, parts.length > 0);
      await chatManager.recordPrivateMessage({
        ...sourceMessage,
        messageId: `${input.messageId}:reply:${lineIndex}`,
        sender: {
          id: "web:yuiju",
          displayName: SUBJECT_NAME,
          isSelf: true,
        },
        elements,
        timestamp: createdAt,
        content: projectWebReplyContent(elements),
      });
    }
  } catch (error) {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, { status: "failed" });
    throw error;
  }

  if (parts.length === 0) {
    await completeWebChatMessage(sourceMessage.sessionId, input.messageId, { status: "failed" });
    throw new Error(`Web chat reply has no supported content: ${input.messageId}`);
  }

  const webResult = {
    status: "replied",
    reply: {
      id: `${input.messageId}:reply`,
      parts,
      createdAt,
    },
  } as const;
  await completeWebChatMessage(sourceMessage.sessionId, input.messageId, webResult);
  return webResult;
}

export async function getWebChatHistory(query: WebChatHistoryQuery): Promise<WebChatHistoryPage> {
  const { ownerId } = getYuijuConfig().message.web;
  const sessionId = buildSatoriPrivateSessionKey("web", ownerId);
  const page = await getWebChatMessagesPage({
    sessionId,
    limit: query.limit,
    cursor: query.cursor,
  });
  const messages: WebChatHistoryMessage[] = [];

  for (const document of page.messages) {
    const createdAt = document.sentAt.getTime();
    messages.push({
      id: document.messageId,
      role: "user",
      text: document.text,
      createdAt,
    });

    if (document.responseStatus === "pending") {
      continue;
    }
    if (!document.completedAt) {
      throw new Error(`Web chat completion time is missing: ${document.messageId}`);
    }

    if (document.responseStatus === "replied") {
      const reply = document.reply;
      if (!reply) {
        throw new Error(`Web chat reply is missing: ${document.messageId}`);
      }
      messages.push({
        id: reply.id,
        role: "assistant",
        parts: reply.parts,
        createdAt: reply.createdAt,
      });
    } else if (document.responseStatus === "no-reply") {
      messages.push({
        id: `${document.messageId}:no-reply`,
        role: "notice",
        text: "她看到了，但此刻没有回复。",
        createdAt: document.completedAt.getTime(),
        tone: "quiet",
      });
    } else if (document.responseStatus === "failed") {
      messages.push({
        id: `${document.messageId}:failed`,
        role: "notice",
        text: "悠酱暂时无法组织回复。",
        createdAt: document.completedAt.getTime(),
        tone: "error",
      });
    } else if (document.responseStatus === "superseded") {
      messages.push({
        id: `${document.messageId}:superseded`,
        role: "notice",
        text: "这条消息已被更新的消息替代。",
        createdAt: document.completedAt.getTime(),
        tone: "quiet",
      });
    }
  }

  return { messages, nextCursor: page.nextCursor };
}

export function getWebChatSticker(key: string) {
  const sticker = stickerState.getByKey(key);
  if (!sticker) {
    return null;
  }

  const extension = extname(sticker.absoluteUri).toLowerCase();
  if (extension !== ".png" && extension !== ".webp") {
    throw new Error(`unsupported Web sticker format: ${extension}`);
  }

  return {
    fileBuffer: sticker.fileBuffer,
    contentType: extension === ".png" ? "image/png" : "image/webp",
  };
}
