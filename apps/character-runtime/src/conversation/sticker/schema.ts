import { z } from "zod";

const annotationSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .min(1)
    .describe("你为表情命名的简短可读 ID，在当前角色和 QQ 账号的收藏中唯一。"),
  description: z.string().trim().min(1).describe("你看图后对画面内容和表达含义的简短描述。"),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .refine((tag) => !/[[\]\r\n]/.test(tag) && tag !== "NO_REPLY"),
    )
    .min(1)
    .transform((tags) => [...new Set(tags)])
    .describe("你为表情选择的情绪、语气或场景标签，不含括号、换行或 NO_REPLY。"),
});
const marketSchema = z.strictObject({
  emojiId: z.string().min(1),
  packageId: z.number().int(),
  key: z.string().min(1).optional(),
});
export const stickerSchema = z.strictObject({
  resId: z.string().min(1),
  md5: z.string().min(1),
  url: z.string().url(),
  market: marketSchema.optional(),
  annotation: annotationSchema.optional(),
  firstSeenAt: z.number(),
  lastSentAt: z.number().optional(),
  sendCount: z.number().int().nonnegative(),
});

export type Sticker = z.infer<typeof stickerSchema>;
export type MarketSticker = z.infer<typeof marketSchema>;
export type StickerImage = { url: string; file: string; md5: string; market?: MarketSticker };
export type PendingSticker = { resId: string; url: string };

export const collectStickerSchema = annotationSchema.extend({
  source: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("message").describe("你从当前群聊中选择图片，收藏到 QQ 并保存标注。"),
      messageId: z.string().min(1).describe("你选择的本群真实消息 ID。"),
      imageIndex: z
        .number()
        .int()
        .nonnegative()
        .describe("你选择的图片在该消息全部图片中的序号，从 0 开始。"),
    }),
    z.strictObject({
      type: z.literal("favorite").describe("你为待标注事件中的已有 QQ 收藏补充标注，不重复收藏。"),
      resId: z.string().min(1).describe("你从待标注事件中取得的 QQ 收藏 resId。"),
    }),
  ]),
});
export const sendMediaSchema = z.strictObject({
  type: z.literal("sticker").describe("你要发送的媒体类型，目前仅支持收藏表情 sticker。"),
  id: z.string().min(1).describe("你从 listStickers 返回的目录中选择的表情 ID。"),
});
