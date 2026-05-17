import { SUBJECT_NAME, visionModel } from "@yuiju/utils";
import { generateText } from "ai";
import type { AllHandlers, NCWebsocket, Receive } from "node-napcat-ts";
import { imageCacheState } from "@/state/image-cache";
import { stickerState } from "@/state/sticker";
import { logger } from "@/utils/logger";

type MessageSegment = Receive[keyof Receive];
type AtMessageSegment = Extract<MessageSegment, { type: "at" }>;
type FaceMessageSegment = Extract<MessageSegment, { type: "face" }>;
type ImageMessageSegment = Extract<MessageSegment, { type: "image" }>;
type ReplyMessageSegment = Extract<MessageSegment, { type: "reply" }>;
type NonEnhancedMessageSegment = Exclude<
  MessageSegment,
  AtMessageSegment | FaceMessageSegment | ReplyMessageSegment | ImageMessageSegment
>;

export type RawGroupMessage = Omit<AllHandlers["message.group"], "quick_action">;
export type RawPrivateMessage = Omit<AllHandlers["message.private"], "quick_action">;
type FetchedProtocolMessage = Awaited<ReturnType<NCWebsocket["get_msg"]>>;
type FetchedGroupMessage = Extract<FetchedProtocolMessage, { message_type: "group" }>;
type FetchedPrivateMessage = Extract<FetchedProtocolMessage, { message_type: "private" }>;

export interface ResolvedReplyMessage {
  messageId: number;
  messageType: "private" | "group";
  speaker: string;
  speakerUserId: number;
  time: number;
  rawMessage: string;
  message: EnhancedMessageSegment[];
}

export interface EnhancedAtSegment extends Omit<AtMessageSegment, "data"> {
  data: AtMessageSegment["data"] & {
    displayName: string;
    isSelf: boolean;
  };
}

export interface EnhancedReplySegment extends Omit<ReplyMessageSegment, "data"> {
  data: ReplyMessageSegment["data"] & {
    resolvedMessage: ResolvedReplyMessage | null;
  };
}

export interface EnhancedImageSegment extends Omit<ImageMessageSegment, "data"> {
  data: ImageMessageSegment["data"] & {
    description?: string;
  };
}

export interface EnhancedFaceSegment extends Omit<FaceMessageSegment, "data"> {
  data: {
    faceText?: string;
  };
}

export type EnhancedMessageSegment =
  | NonEnhancedMessageSegment
  | EnhancedFaceSegment
  | EnhancedImageSegment
  | EnhancedAtSegment
  | EnhancedReplySegment;

export type StoredGroupMessage = Omit<RawGroupMessage, "message" | "post_type"> & {
  post_type: "message" | "message_sent";
  message: EnhancedMessageSegment[];
};

export type StoredPrivateMessage = Omit<RawPrivateMessage, "message" | "post_type"> & {
  post_type: "message" | "message_sent";
  message: EnhancedMessageSegment[];
};

export type StoredProtocolMessage = StoredPrivateMessage | StoredGroupMessage;

export interface HistoryReplySegment {
  type: "reply";
  data: {
    speaker?: string;
    content: HistoryMessageSegment[];
  };
}

export interface HistoryAtSegment {
  type: "at";
  data: {
    displayName: string;
  };
}

export interface HistoryImageSegment {
  type: "image";
  data: {
    description?: string;
  };
}

export type HistoryMessageSegment =
  | Exclude<EnhancedMessageSegment, EnhancedReplySegment | EnhancedAtSegment | EnhancedImageSegment>
  | HistoryImageSegment
  | HistoryAtSegment
  | HistoryReplySegment;

export interface HistoryMessageItem {
  speaker: string;
  time: string;
  content: HistoryMessageSegment[];
}

/**
 * 供 LLM 消费的结构化历史项。
 *
 * 说明：
 * - 这里只描述真实消息，不再混入滚动摘要；
 * - 摘要会由上层 prompt 以独立文本章节注入。
 */
export type HistoryJsonItem = HistoryMessageItem;

interface BaseSegmentsTransferInput {
  napcat: NCWebsocket;
  segments: MessageSegment[];
  selfId: number;
  resolveReply: boolean;
}

interface GroupSegmentsTransferInput extends BaseSegmentsTransferInput {
  scene: "group";
  groupId: number;
}

interface PrivateSegmentsTransferInput extends BaseSegmentsTransferInput {
  scene: "private";
}

type SegmentsTransferInput = GroupSegmentsTransferInput | PrivateSegmentsTransferInput;

type ReplyMessage = FetchedProtocolMessage;

/**
 * 根据“下一条即将发送”的文本长度估算等待间隔，让消息节奏更接近真人组织下一句回复。
 *
 * 说明：
 * - 基础等待保证极短句也不会瞬间连发；
 * - 按字符数线性增加等待时间，使长句拥有更自然的停顿；
 * - 使用上下限避免回复过慢；
 * - 叠加轻微随机扰动，减少固定模板感。
 */
export function getReplyDelayMs(text: string): number {
  const baseDelayMs = 1000;
  const perCharacterDelayMs = 200;
  const minDelayMs = 400;
  const maxDelayMs = 10000;
  const randomJitterMs = (Math.random() - 0.5) * 360;
  const estimatedDelayMs = baseDelayMs + text.trim().length * perCharacterDelayMs;

  return Math.round(Math.min(maxDelayMs, Math.max(minDelayMs, estimatedDelayMs + randomJitterMs)));
}

/**
 * 统一判断群消息是否在当前语义上“直接对悠酱说话”。
 *
 * 说明：
 * - `@self` 明确视为直接对话；
 * - `reply` 段视作直接回复链路，避免漏掉最常见的引用回复场景。
 */
export async function isGroupMessageDirectedToBot(
  message: RawGroupMessage | StoredGroupMessage,
  napcat: NCWebsocket,
): Promise<{
  type?: "at" | "reply";
  isDriectedToBot: boolean;
}> {
  try {
    for (const segment of message.message) {
      if (segment.type === "at") {
        return {
          type: "at",
          isDriectedToBot: segment.data.qq === String(message.self_id),
        };
      }
      if (segment.type === "reply") {
        const replyMessage = await napcat.get_msg({
          message_id: Number(segment.data.id),
        });

        return {
          type: "reply",
          isDriectedToBot: replyMessage?.sender?.user_id === message.self_id,
        };
      }
    }
  } catch (error) {
    logger.error("isGroupMessageDirectedToBot", error);
  }

  return {
    type: undefined,
    isDriectedToBot: false,
  };
}

/**
 * 将 Napcat 原始消息段增强为更适合 LLM 理解的结构化消息段。
 *
 * 说明：
 * - `at` 会补齐展示昵称；
 * - `reply` 会直接拉取被引用消息，并只展开一层；
 * - 其他消息段保持原始结构，避免额外包装。
 */
export async function segmentsTransfer(
  input: SegmentsTransferInput,
): Promise<EnhancedMessageSegment[]> {
  return Promise.all(
    input.segments.map(async (segment) => {
      switch (segment.type) {
        case "text":
          return segment;
        case "image":
          return resolveImageSegment(segment);
        case "face":
          return {
            type: "face",
            data: {
              faceText: segment.data.raw.faceText,
            },
          };
        case "record":
        case "video":
        case "file":
          return segment;
        case "at":
          return resolveAtSegment(segment, input);
        case "reply":
          return resolveReplySegment(segment, input);
        default:
          return segment as NonEnhancedMessageSegment;
      }
    }),
  );
}

/**
 * 将群聊原始消息转换为 session 中保存的增强消息。
 */
export async function createStoredGroupMessage(
  message: RawGroupMessage,
  napcat: NCWebsocket,
): Promise<StoredGroupMessage> {
  return {
    ...message,
    message: await segmentsTransfer({
      napcat,
      segments: message.message,
      selfId: message.self_id,
      scene: "group",
      groupId: message.group_id,
      resolveReply: true,
    }),
  };
}

/**
 * 将 Napcat `get_msg` 取回的群消息转换为 session 中保存的增强消息。
 *
 * 说明：
 * - 主要用于发送成功后回读机器人自己的真实消息；
 * - 保留 Napcat 实际返回的 `message_id`、`post_type` 等字段，避免手工构造漂移。
 */
export async function createStoredGroupMessageFromFetched(
  message: FetchedGroupMessage,
  napcat: NCWebsocket,
): Promise<StoredGroupMessage> {
  return {
    ...message,
    message: await segmentsTransfer({
      napcat,
      segments: message.message,
      selfId: message.self_id,
      scene: "group",
      groupId: message.group_id,
      resolveReply: true,
    }),
  };
}

/**
 * 将私聊原始消息转换为 session 中保存的增强消息。
 */
export async function createStoredPrivateMessage(
  message: RawPrivateMessage,
  napcat: NCWebsocket,
): Promise<StoredPrivateMessage> {
  return {
    ...message,
    message: await segmentsTransfer({
      napcat,
      segments: message.message,
      selfId: message.self_id,
      scene: "private",
      resolveReply: true,
    }),
  };
}

/**
 * 将 Napcat `get_msg` 取回的私聊消息转换为 session 中保存的增强消息。
 *
 * 说明：
 * - 主要用于发送成功后回读机器人自己的真实消息；
 * - 和收到用户私聊时使用同一套消息增强逻辑，保证历史上下文结构一致。
 */
export async function createStoredPrivateMessageFromFetched(
  message: FetchedPrivateMessage,
  napcat: NCWebsocket,
): Promise<StoredPrivateMessage> {
  return {
    ...message,
    message: await segmentsTransfer({
      napcat,
      segments: message.message,
      selfId: message.self_id,
      scene: "private",
      resolveReply: true,
    }),
  };
}

/**
 * 获取群会话展示名，优先使用运行时携带的群名，没有时回退到群号。
 */
export function getGroupDisplayName(message: RawGroupMessage | StoredGroupMessage): string {
  if ("group_name" in message && typeof message.group_name === "string") {
    const groupName = message.group_name.trim();
    if (groupName) {
      return groupName;
    }
  }

  return String(message.group_id);
}

/**
 * 获取协议消息发送者展示名，优先群名片，其次昵称，最后回退到 user_id。
 */
export function getProtocolMessageSenderName(message: StoredProtocolMessage): string {
  return message?.sender?.card || message?.sender?.nickname || String(message?.sender?.user_id);
}

/**
 * 将增强后的消息段进一步投影为更适合 LLM 理解的历史内容。
 *
 * 说明：
 * - 顶层 `reply` 仅保留“引用了谁”和“引用内容是什么”；
 * - reply 的冗余元数据（id、时间、raw_message 等）会被剔除；
 * - 嵌套 reply 不再继续保留，避免引用链层层展开。
 */
export function projectHistoryMessageContent(
  segments: EnhancedMessageSegment[],
): HistoryMessageSegment[] {
  return segments.map<HistoryMessageSegment>((segment) => {
    if (segment.type === "at") {
      return {
        type: "at",
        data: {
          displayName: segment.data.displayName,
        },
      };
    }

    if (segment.type === "image") {
      return {
        type: "image",
        data: {
          description: segment.data.description,
        },
      };
    }

    if (segment.type !== "reply") {
      return segment;
    }

    const resolvedMessage = segment.data.resolvedMessage;
    const content = resolvedMessage ? projectReplyContentSegments(resolvedMessage.message) : [];

    return {
      type: "reply",
      data: {
        speaker: resolvedMessage?.speaker,
        content,
      },
    };
  });
}

async function resolveImageSegment(segment: ImageMessageSegment): Promise<EnhancedImageSegment> {
  const stickerDescription = getStickerDescription(segment);
  if (stickerDescription) {
    return buildEnhancedImageSegment(segment, stickerDescription);
  }

  const cachedDescription = imageCacheState.get(segment.data.file);
  if (cachedDescription) {
    return buildEnhancedImageSegment(segment, cachedDescription);
  }

  const generatedDescription = await generateImageDescription(segment);
  if (generatedDescription) {
    imageCacheState.set(segment.data.file, generatedDescription);
    return buildEnhancedImageSegment(segment, generatedDescription);
  }

  const fallbackDescription = segment.data.summary?.trim();
  if (fallbackDescription) {
    return buildEnhancedImageSegment(segment, fallbackDescription);
  }

  return buildEnhancedImageSegment(segment);
}

async function resolveAtSegment(
  segment: AtMessageSegment,
  input: SegmentsTransferInput,
): Promise<EnhancedAtSegment> {
  const qq = segment.data.qq;

  if (qq === "all") {
    return {
      ...segment,
      data: {
        ...segment.data,
        displayName: "全体成员",
        isSelf: false,
      },
    };
  }

  if (qq === String(input.selfId)) {
    return {
      ...segment,
      data: {
        ...segment.data,
        displayName: SUBJECT_NAME,
        isSelf: true,
      },
    };
  }

  const displayName =
    input.scene === "group"
      ? await resolveGroupMemberDisplayName(input.napcat, input.groupId, qq)
      : await resolvePrivateMentionDisplayName(input.napcat, qq);

  return {
    ...segment,
    data: {
      ...segment.data,
      displayName,
      isSelf: false,
    },
  };
}

function getStickerDescription(segment: ImageMessageSegment): string | null {
  const stickerKey = segment.data.summary?.trim();
  if (!stickerKey) {
    return null;
  }

  const sticker = stickerState.getByKey(stickerKey);
  return sticker?.description || null;
}

async function generateImageDescription(segment: ImageMessageSegment): Promise<string | null> {
  const imageUrl = segment.data.url?.trim();
  if (!imageUrl) {
    return null;
  }

  const summary = segment.data.summary?.trim();
  const summaryText = summary || "空";

  try {
    const result = await generateText({
      model: visionModel,
      providerOptions: {
        vision: {
          enable_thinking: false,
        },
      },
      system:
        "你是聊天消息图片描述器。请只根据图片内容输出一小段简洁、客观、自然的中文描述，方便后续聊天理解上下文，不要输出解释、身份猜测或额外寒暄。",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "请描述这张图片里最重要的可见内容，控制在 100 字以内。",
                `这个图片的 summary: ${summaryText}。`,
                "这个字段有语义，不是无意义元数据。",
                "如果 summary 是 [动画表情]，说明这更像 QQ 动画表情或表情包消息；如果 summary 为空，通常是普通图片。",
                "请把 summary 当作辅助线索，与图片内容一起判断，但不要机械复述字段名。",
              ].join("\n"),
            },
            {
              type: "image",
              image: imageUrl,
            },
          ],
        },
      ],
    });

    const description = result.text.trim();
    return description || null;
  } catch (error) {
    logger.warn("[message.image] 图片描述生成失败，降级为 summary", {
      file: segment.data.file,
      summary: segment.data.summary,
      error,
    });
    return null;
  }
}

function buildEnhancedImageSegment(
  segment: ImageMessageSegment,
  description?: string,
): EnhancedImageSegment {
  if (!description) {
    return {
      ...segment,
      data: {
        ...segment.data,
      },
    };
  }

  return {
    ...segment,
    data: {
      ...segment.data,
      description,
    },
  };
}

async function resolveReplySegment(
  segment: ReplyMessageSegment,
  input: SegmentsTransferInput,
): Promise<EnhancedReplySegment> {
  if (!input.resolveReply) {
    return {
      ...segment,
      data: {
        ...segment.data,
        resolvedMessage: null,
      },
    };
  }

  const resolvedMessage = await getResolvedReplyMessage(
    segment.data.id,
    input.napcat,
    input.selfId,
  );

  return {
    ...segment,
    data: {
      ...segment.data,
      resolvedMessage,
    },
  };
}

async function resolveGroupMemberDisplayName(
  napcat: NCWebsocket,
  groupId: number,
  qq: string,
): Promise<string> {
  const userId = Number(qq);
  if (Number.isNaN(userId)) {
    return qq;
  }

  try {
    const member = await napcat.get_group_member_info({
      group_id: groupId,
      user_id: userId,
    });

    return member.card || member.nickname || String(member.user_id);
  } catch {
    return qq;
  }
}

async function resolvePrivateMentionDisplayName(napcat: NCWebsocket, qq: string): Promise<string> {
  const userId = Number(qq);
  if (Number.isNaN(userId)) {
    return qq;
  }

  try {
    const stranger = await napcat.get_stranger_info({
      user_id: userId,
    });

    return stranger.nickname?.trim() || String(stranger.user_id);
  } catch {
    return qq;
  }
}

async function getResolvedReplyMessage(
  replyMessageId: string,
  napcat: NCWebsocket,
  selfId: number,
): Promise<ResolvedReplyMessage | null> {
  const messageId = Number(replyMessageId);
  if (Number.isNaN(messageId)) {
    return null;
  }

  try {
    const message = await napcat.get_msg({ message_id: messageId });
    return buildResolvedReplyMessage(message, napcat, selfId);
  } catch {
    return null;
  }
}

async function buildResolvedReplyMessage(
  message: ReplyMessage,
  napcat: NCWebsocket,
  selfId: number,
): Promise<ResolvedReplyMessage> {
  const storedMessage = await segmentsTransfer(
    message.message_type === "group"
      ? {
          napcat,
          segments: message.message,
          selfId,
          scene: "group",
          groupId: message.group_id,
          resolveReply: false,
        }
      : {
          napcat,
          segments: message.message,
          selfId,
          scene: "private",
          resolveReply: false,
        },
  );

  return {
    messageId: message.message_id,
    messageType: message.message_type,
    speaker:
      message.sender.card?.trim() ||
      message.sender.nickname?.trim() ||
      String(message.sender.user_id),
    speakerUserId: message.sender.user_id,
    time: message.time,
    rawMessage: message.raw_message,
    message: storedMessage,
  };
}

function projectReplyContentSegments(segments: EnhancedMessageSegment[]): HistoryMessageSegment[] {
  return segments.flatMap<HistoryMessageSegment>((segment) => {
    if (segment.type === "reply") {
      return [];
    }

    if (segment.type === "at") {
      return [
        {
          type: "at",
          data: {
            displayName: segment.data.displayName,
          },
        },
      ];
    }

    if (segment.type === "image") {
      return [
        {
          type: "image",
          data: {
            description: segment.data.description,
          },
        },
      ];
    }

    return [segment];
  });
}
