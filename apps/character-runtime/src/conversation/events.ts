import { z } from "zod";
import { conversationAgentEventSchema } from "../communication";

/** 标注输入来自 QQ 收藏对账，不伪装成主 loop 分享或实际群消息。 */
export const stickerAnnotationEventSchema = z.strictObject({
  type: z.literal("sticker_annotation"),
  id: z.string(),
  occurredAt: z.number(),
  content: z.string(),
  resIds: z.array(z.string()),
});

export const conversationInputEventSchema = z.discriminatedUnion("type", [
  ...conversationAgentEventSchema.options,
  stickerAnnotationEventSchema,
]);

export type ConversationInputEvent = z.infer<typeof conversationInputEventSchema>;
