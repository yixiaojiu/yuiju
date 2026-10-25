import type { ExtensionWebDefinition } from "@yuiju/shared/extension/web";
import { InteractionPage } from "./src/web/interaction-page.tsx";
import { Live2DPage } from "./src/web/live2d-page.tsx";
import { SubtitlePage } from "./src/web/subtitle-page.tsx";
export default {
  pages: [
    { id: "studio", title: "互动", access: "private", component: InteractionPage },
    {
      id: "live2d",
      title: "Live2D",
      access: "private",
      layout: "standalone",
      component: Live2DPage,
    },
    {
      id: "subtitle",
      title: "字幕",
      access: "private",
      layout: "standalone",
      component: SubtitlePage,
    },
  ],
} satisfies ExtensionWebDefinition;
