import {
  type StickersResponse,
  stickerAnnotationSchema,
} from "@yuiju/shared/character-runtime/protocol";
import { Hono } from "hono";
import type { Conversation } from "../conversation/conversation";
import { STICKER_LIMIT } from "../conversation/sticker/collection";

/** 参数校验与响应转换留在 HTTP 入口，收藏规则及副作用由业务实例执行。 */
export function createStickerApi(characterId: string, conversation: Conversation | undefined) {
  const collection = conversation?.stickerCollection;
  return new Hono()
    .use("*", async (c, next) => {
      if (!collection) {
        return c.json({ error: "当前角色或运行模式未启用聊天模块" }, 503);
      }
      await next();
    })
    .get("/", async (c) =>
      c.json({
        characterId,
        limit: STICKER_LIMIT,
        stickers: await collection!.listForManagement(),
      } satisfies StickersResponse),
    )
    .put("/:resId/annotation", async (c) => {
      const parsed = stickerAnnotationSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "ID、描述或标签无效，标签不能包含括号、换行或 NO_REPLY" }, 400);
      }
      await collection!.updateAnnotation(c.req.param("resId"), parsed.data);
      return c.json({ ok: true });
    })
    .delete("/:resId", async (c) => {
      await collection!.remove(c.req.param("resId"));
      return c.json({ ok: true });
    })
    .post("/sync", async (c) => {
      await conversation!.synchronizeStickers();
      return c.json({ ok: true });
    })
    .get("/:resId/image", async (c) => {
      const image = await collection!.readImage(c.req.param("resId"));
      return new Response(Uint8Array.from(image.data), {
        headers: { "Content-Type": image.contentType, "Cache-Control": "no-store" },
      });
    });
}
