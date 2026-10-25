import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionApiContext } from "@yuiju/shared/extension/api";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getInteractionDirectory, readCharacterConfig } from "../config.ts";
import { readLive2DExpressions } from "../live2d.ts";
import { transcribeSpeech } from "./asr.ts";
import { synthesizeSpeech } from "./tts.ts";

/** 仅角色相关接口要求角色 ID；公共资源接口不使用此校验。 */
const characterQuery = validator("query", (query, c) => {
  const parsed = z.object({ characterId: z.string().min(1) }).safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "请提供 characterId" }, 400);
  }
  return parsed.data;
});

/** 宿主挂载到 /api/extensions/yuiju-interaction；这里只声明相对路由。 */
export function createRoutes({ getCharacter, prepareScene, getSceneStatus }: ExtensionApiContext) {
  return new Hono()
    .post("/scene", characterQuery, async (c) => {
      const input = z.strictObject({ context: z.string().optional() }).parse(await c.req.json());
      return c.json(
        await prepareScene(c.req.valid("query").characterId, "interaction", input.context),
      );
    })
    .get("/scene", characterQuery, async (c) => {
      const sessionId = z.string().min(1).parse(c.req.query("sessionId"));
      return c.json(
        await getSceneStatus(c.req.valid("query").characterId, "interaction", sessionId),
      );
    })
    .get("/settings", characterQuery, async (c) => {
      const character = getCharacter(c.req.valid("query").characterId);
      const config = await readCharacterConfig(character.id);
      return c.json({
        connection: config.connection,
        modelPath: config.live2d.model,
        expressions: await readLive2DExpressions(config.live2d),
        asrAvailable: config.asr !== undefined,
      });
    })
    .get("/live2d/*", async (c) => {
      const root = resolve(await getInteractionDirectory(), "live2d");
      const pathname = new URL(c.req.url).pathname;
      const requested = resolve(
        root,
        decodeURIComponent(pathname.slice(pathname.indexOf("/live2d/") + 8)),
      );
      const withinRoot = relative(root, requested);
      if (isAbsolute(withinRoot) || withinRoot.startsWith("..")) {
        return c.notFound();
      }
      const mime: Record<string, string> = {
        ".json": "application/json",
        ".png": "image/png",
        ".moc3": "application/octet-stream",
      };
      if (!mime[extname(requested)]) {
        return c.notFound();
      }
      c.header("Content-Type", mime[extname(requested)]);
      return c.body(new Uint8Array(await readFile(requested)));
    })
    .post("/asr", characterQuery, async (c) => {
      const character = getCharacter(c.req.valid("query").characterId);
      const config = await readCharacterConfig(character.id);
      if (!config.asr) {
        return c.json({ error: "此角色未配置 ASR" }, 400);
      }
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60_000)]);
      return c.json({ text: await transcribeSpeech(await c.req.blob(), signal, config.asr) });
    })
    .post("/tts", characterQuery, async (c) => {
      const character = getCharacter(c.req.valid("query").characterId);
      const config = await readCharacterConfig(character.id);
      const input = z.object({ text: z.string().trim().min(1) }).parse(await c.req.json());
      const audio = await synthesizeSpeech({
        text: input.text,
        emotion: "neutral",
        config: config.tts,
        signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60_000)]),
      });
      c.header("Content-Type", audio.type);
      return c.body(new Uint8Array(await audio.arrayBuffer()));
    });
}
