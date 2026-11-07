import { stickerAnnotationSchema } from "@yuiju/shared/character-runtime/protocol";
import { Hono } from "hono";
import { requestCharacterRuntime } from "@/lib/character-runtime";
import { getDeployment } from "@/lib/deployment";
import { getQueryCharacter } from "../character-query";

/** 浏览器只访问 Dashboard，角色选择在此校验，图片通过同一链路流式转发。 */
export const stickersApi = new Hono()
  .onError((error, c) => {
    if (error instanceof SyntaxError) {
      return c.json({ error: "请求正文必须是有效 JSON" }, 400);
    }
    throw error;
  })
  .use("*", async (c, next) => {
    const deployment = await getDeployment();
    if (deployment.publicDeployment) {
      return c.notFound();
    }
    getQueryCharacter(c.req.query("characterId"), deployment.characters);
    await next();
  })
  .get("/", async (c) => await requestCharacterRuntime(c.req.query("characterId")!, "/stickers"))
  .put("/:resId/annotation", async (c) => {
    const parsed = stickerAnnotationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "ID、描述或标签无效，标签不能包含括号、换行或 NO_REPLY" }, 400);
    }
    return await requestCharacterRuntime(
      c.req.query("characterId")!,
      `/stickers/${encodeURIComponent(c.req.param("resId"))}/annotation`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      },
    );
  })
  .delete(
    "/:resId",
    async (c) =>
      await requestCharacterRuntime(
        c.req.query("characterId")!,
        `/stickers/${encodeURIComponent(c.req.param("resId"))}`,
        { method: "DELETE" },
      ),
  )
  .post(
    "/sync",
    async (c) =>
      await requestCharacterRuntime(c.req.query("characterId")!, "/stickers/sync", {
        method: "POST",
      }),
  )
  .get(
    "/:resId/image",
    async (c) =>
      await requestCharacterRuntime(
        c.req.query("characterId")!,
        `/stickers/${encodeURIComponent(c.req.param("resId"))}/image`,
      ),
  );
