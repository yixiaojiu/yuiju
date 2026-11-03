import { tool } from "ai";
import { z } from "zod";
import { collectStickerSchema, sendMediaSchema } from "./schema";

export const stickerTools = {
  collectSticker: tool({
    description:
      "你想收藏看过的表情，或为待标注收藏补充唯一 ID、描述和标签时调用。已有完整记录会返回原记录，不覆盖标注。",
    inputSchema: collectStickerSchema,
  }),
  listStickers: tool({
    description: "你需要选择表情时调用，返回当前可发送收藏的 ID、描述和标签。",
    inputSchema: z.strictObject({}),
  }),
  sendMedia: tool({
    description:
      "你想直接发送一张收藏表情时调用，按 ID 精确发送，返回实际发送结果。结果未确认时，不要重复执行。",
    inputSchema: sendMediaSchema,
  }),
};
