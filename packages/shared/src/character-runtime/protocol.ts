import { z } from "zod";

/** 人工管理与角色收藏使用相同的标注契约。 */
export const stickerAnnotationSchema = z.strictObject({
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

export type StickerAnnotation = z.infer<typeof stickerAnnotationSchema>;
export type StickerImageStatus = "pending" | "ready" | "failed";
export type ManagedSticker = {
  resId: string;
  type: "custom" | "market";
  annotation?: StickerAnnotation;
  firstSeenAt: number;
  lastSentAt?: number;
  sendCount: number;
  status: "sendable" | "unannotated" | "missing_send_info";
  imageStatus: StickerImageStatus;
};
export type StickersResponse = { characterId: string; limit: number; stickers: ManagedSticker[] };
