import { load_config } from "@yuiju/shared/config/load";
import type { ExtensionApiImport } from "@yuiju/shared/extension/api";
import { isExtensionEnabled } from "@yuiju/shared/extension/enabled";
import { requestSceneCommand } from "@yuiju/shared/extension/scene-requests";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { extensionApis } from "@/extensions/generated-api";

/** 插件路由挂在自己的命名空间内；角色启用检查只在服务端处理。 */
export const extensionsApi = new Hono().all("/:extension/*", async (c) => {
  const { extension } = c.req.param();
  const config = await load_config();
  const imports: readonly ExtensionApiImport[] = extensionApis;
  const entry = imports.find((entry) => entry.extension === extension);
  if (!entry) {
    return c.notFound();
  }
  const { default: definition } = await entry.load();
  if (config.app!.public_deployment && definition.access !== "public") {
    return c.notFound();
  }
  function getCharacter(characterId: string) {
    const character = config.characters![characterId];
    if (!character || !isExtensionEnabled(character, extension)) {
      throw new HTTPException(404, { message: "角色不存在或未启用此扩展" });
    }
    return { id: characterId, name: character.name };
  }
  const routes = definition.create({
    getCharacter,
    async prepareScene(characterId, agentId, context) {
      if (config.app!.public_deployment) {
        throw new HTTPException(403, { message: "公开部署不能控制角色场景" });
      }
      getCharacter(characterId);
      try {
        return await requestSceneCommand(characterId, {
          type: "prepare",
          agentId: `${extension}/${agentId}`,
          context,
        });
      } catch (error) {
        throw new HTTPException(409, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async getSceneStatus(characterId, agentId, sessionId) {
      if (config.app!.public_deployment) {
        throw new HTTPException(403, { message: "公开部署不能查询角色场景会话" });
      }
      getCharacter(characterId);
      try {
        return await requestSceneCommand(characterId, {
          type: "status",
          agentId: `${extension}/${agentId}`,
          sessionId,
        });
      } catch (error) {
        throw new HTTPException(409, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
  const mounted = new Hono().route(`/api/extensions/${encodeURIComponent(extension)}`, routes);
  // 交回 Dashboard 统一错误处理；插件自己声明的错误处理仍由插件负责。
  mounted.onError((error) => {
    throw error;
  });
  return await mounted.fetch(c.req.raw);
});
