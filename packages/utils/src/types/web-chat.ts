import { z } from "zod";

export const webChatMessageInputSchema = z.strictObject({
  messageId: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2000),
  sentAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type WebChatMessageInput = z.infer<typeof webChatMessageInputSchema>;

export const webChatReplyPartSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal("sticker"),
    key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    url: z.string().startsWith("/api/chat/stickers/"),
  }),
]);

export type WebChatReplyPart = z.infer<typeof webChatReplyPartSchema>;

export const webChatReplySchema = z.strictObject({
  id: z.string().min(1),
  parts: z.array(webChatReplyPartSchema).min(1),
  createdAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type WebChatReply = z.infer<typeof webChatReplySchema>;

export const webChatResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("replied"),
    reply: webChatReplySchema,
  }),
  z.strictObject({ status: z.literal("no-reply") }),
  z.strictObject({ status: z.literal("failed") }),
  z.strictObject({ status: z.literal("superseded") }),
  z.strictObject({ status: z.literal("pending-conflict") }),
  z.strictObject({ status: z.literal("message-conflict") }),
]);

export type WebChatResult = z.infer<typeof webChatResultSchema>;

export const webChatHistoryCursorSchema = z.strictObject({
  sentAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export type WebChatHistoryCursor = z.infer<typeof webChatHistoryCursorSchema>;

export const webChatHistoryQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(100),
  cursor: webChatHistoryCursorSchema.optional(),
});

export type WebChatHistoryQuery = z.infer<typeof webChatHistoryQuerySchema>;

export const webChatHistoryMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    id: z.string().min(1),
    role: z.literal("user"),
    text: z.string(),
    createdAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    id: z.string().min(1),
    role: z.literal("assistant"),
    parts: z.array(webChatReplyPartSchema).min(1),
    createdAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    id: z.string().min(1),
    role: z.literal("notice"),
    text: z.string(),
    createdAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    tone: z.enum(["quiet", "error"]),
  }),
]);

export type WebChatHistoryMessage = z.infer<typeof webChatHistoryMessageSchema>;

export const webChatHistoryPageSchema = z.strictObject({
  messages: z.array(webChatHistoryMessageSchema),
  nextCursor: webChatHistoryCursorSchema.nullable(),
});

export type WebChatHistoryPage = z.infer<typeof webChatHistoryPageSchema>;
