import type { ExtensionDefinition } from "@yuiju/shared/extension/agent";
import { InteractionScene } from "./src/agent/scene.ts";
import { compressionPrompt, scenePresetPrompts, scenePrompt } from "./src/prompts.ts";

export default {
  prompts: [scenePrompt, ...scenePresetPrompts, compressionPrompt],
  agents: [
    {
      id: "interaction",
      type: "scene",
      description:
        "进入电脑互动场景，观察和操作电脑提供的画面，通过 Live2D 表演、语音和文字与用户互动。",
      instructions:
        "你需要在自己家里且不在睡觉，才能申请进入。等待用户连接画面与操作入口并确认进入；正式进入后手头活动暂停，退出后继续。互动内容由当次上下文决定，结束后带回实际经历。目前支持的画面与操作入口是用户选定的浏览器标签页。",
      checkEntry(world) {
        const { position, home } = world;
        if (
          position.type !== "at_place" ||
          !position.hierarchy.some((place) => place.placeId === home.placeId)
        ) {
          return "需要先回到自己的家里，才能准备电脑互动。";
        }
        return null;
      },
      pauseConversation: true,
      create: (context) => new InteractionScene(context),
    },
  ],
} satisfies ExtensionDefinition;
