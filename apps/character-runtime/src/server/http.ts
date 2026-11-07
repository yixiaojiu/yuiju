import { logger } from "@yuiju/shared/logger/logger";
import { Hono } from "hono";
import type { Character } from "../character";
import { StickerCollectionError } from "../conversation/sticker/collection";
import { createStickerApi } from "./stickers";

export function createCharacterHttpApp(character: Pick<Character, "id" | "conversation">) {
  const app = new Hono().basePath("/api");
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, characterId: character.id }));
  app.route("/stickers", createStickerApi(character.id, character.conversation));
  app.onError((error, c) => {
    if (error instanceof SyntaxError) {
      return c.json({ error: "请求正文必须是有效 JSON" }, 400);
    }
    if (error instanceof StickerCollectionError) {
      return c.json(
        { error: error.message },
        error.code === "not_found" ? 404 : error.code === "duplicate_id" ? 400 : 409,
      );
    }
    logger.error("角色 HTTP 请求失败", { path: c.req.path, error });
    return c.json({ error: `操作未完整确认，请重新查询或同步：${error.message}` }, 500);
  });
  return app;
}
