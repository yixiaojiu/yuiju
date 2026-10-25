"use client";
import type { ExtensionPageProps } from "@yuiju/shared/extension/web";
import { useEffect, useRef } from "react";
import type { ServerMessage } from "../protocol.ts";
import { loadCubismCore } from "./live2d/load-core.ts";
import type { Live2DStage } from "./live2d/stage.ts";
import type { PageSettings } from "./session.ts";

/** Live2D 展示页只展示控制页的模型状态，不创建表演队列、AudioContext 或 agent 输入。 */
export function Live2DPage({ character, apiBasePath }: ExtensionPageProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let stage: Live2DStage | undefined;
    let script: HTMLScriptElement | undefined;
    let socket: WebSocket | undefined;

    async function initialize() {
      try {
        const response = await fetch(
          `${apiBasePath}/settings?${new URLSearchParams({ characterId: character.id })}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`读取 Live2D 模型配置失败：${response.status}`);
        }
        const settings: PageSettings = await response.json();
        script = await loadCubismCore(controller.signal);
        const { createStage } = await import("./live2d/stage.ts");
        controller.signal.throwIfAborted();
        stage = await createStage(
          container.current!,
          `${apiBasePath}/${settings.modelPath}`,
          settings.expressions,
          { mode: "mirror" },
        );
        if (controller.signal.aborted) {
          stage.destroy();
          return;
        }
        socket = new WebSocket(settings.connection.url);
        socket.onopen = () => {
          socket!.send(
            JSON.stringify({ type: "hello", role: "observer", token: settings.connection.token }),
          );
        };
        socket.onmessage = (message) => {
          const event: ServerMessage = JSON.parse(message.data);
          if (event.type === "live2d_frame") {
            stage!.applyFrame(event.frame);
          } else if (event.type === "error") {
            console.error("Live2D 展示页连接错误", event.message);
          }
        };
        socket.onerror = () =>
          console.error("Live2D 展示页无法连接互动 agent，请在场景就绪后刷新页面。");
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Live2D 展示页初始化失败", error);
        }
      }
    }
    initialize();
    return () => {
      controller.abort();
      socket?.close();
      stage?.destroy();
      script?.remove();
    };
  }, [character.id, apiBasePath]);

  return <div ref={container} className="h-dvh w-full overflow-hidden" />;
}
