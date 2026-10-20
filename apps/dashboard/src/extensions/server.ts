import { load_config } from "@yuiju/shared/config/load";
import { isExtensionEnabled } from "@yuiju/shared/extension/enabled";
import type { ExtensionWebImport } from "@yuiju/shared/extension/web";
import { cache } from "react";
import { extensionPages } from "./generated-pages";

/** 页面和导航共用本次服务端渲染的可见列表；客户端只会收到筛选后的菜单链接。 */
export const getExtensionPages = cache(async () => {
  const config = await load_config();
  const imports: readonly ExtensionWebImport[] = extensionPages;
  const pages = [];
  for (const entry of imports) {
    const characters = Object.entries(config.characters!).filter(([, character]) =>
      isExtensionEnabled(character, entry.extension),
    );
    if (!characters.length) {
      continue;
    }
    const { default: definition } = await entry.load();
    const pageIds = new Set<string>();
    for (const page of definition.pages) {
      if (!page.id || page.id.includes("/") || pageIds.has(page.id)) {
        throw new Error(
          `扩展 ${entry.extension} 的页面 ID 必须非空、不包含 / 且不能重复：${page.id}`,
        );
      }
      pageIds.add(page.id);
      if (config.app!.public_deployment && page.access !== "public") {
        continue;
      }
      for (const [id, character] of characters) {
        const path = `${encodeURIComponent(entry.extension)}/${encodeURIComponent(id)}`;
        pages.push({
          extension: entry.extension,
          pageId: page.id,
          title: page.title,
          character: { id, name: character.name },
          href: `/extensions/${path}/${encodeURIComponent(page.id)}`,
          apiBasePath: `/api/extensions/${path}`,
          component: page.component,
        });
      }
    }
  }
  return pages;
});
