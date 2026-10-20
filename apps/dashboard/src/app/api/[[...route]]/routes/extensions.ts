import { load_config } from "@yuiju/shared/config/load";
import type { ExtensionApiImport } from "@yuiju/shared/extension/api";
import { isExtensionEnabled } from "@yuiju/shared/extension/enabled";
import { Hono } from "hono";
import { extensionApis } from "@/extensions/generated-api";

/** 插件路由挂在自己的命名空间内；授权与配置只在服务端处理。 */
export const extensionsApi = new Hono().all("/:extension/:characterId/*", async (c) => {
  const { extension, characterId } = c.req.param();
  const config = await load_config();
  const character = config.characters![characterId];
  const imports: readonly ExtensionApiImport[] = extensionApis;
  const entry = imports.find((entry) => entry.extension === extension);
  if (!entry || !character || !isExtensionEnabled(character, extension)) {
    return c.notFound();
  }
  const { default: definition } = await entry.load();
  if (config.app!.public_deployment && definition.access !== "public") {
    return c.notFound();
  }
  const { enabled, ...parameters } = character.extensions![extension];
  const parsed = definition.configSchema.safeParse(parameters);
  if (!parsed.success) {
    throw new Error(`角色 ${characterId} 的扩展 ${extension} 配置错误：${parsed.error.message}`);
  }
  const routes = definition.create({
    character: { id: characterId, name: character.name },
    config: parsed.data,
  });
  const mounted = new Hono().route(
    `/api/extensions/${encodeURIComponent(extension)}/${encodeURIComponent(characterId)}`,
    routes,
  );
  // 交回 Dashboard 统一错误处理；插件自己声明的错误处理仍由插件负责。
  mounted.onError((error) => {
    throw error;
  });
  return await mounted.fetch(c.req.raw);
});
