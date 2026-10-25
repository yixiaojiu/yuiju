"use client";
import type { ExtensionPageProps } from "@yuiju/shared/extension/web";
import { useEffect, useState } from "react";
import type { ServerMessage } from "../protocol.ts";
import type { PageSettings } from "./session.ts";

/** 只展示控制页当前播放的字幕，不生成或播放音频。 */
export function SubtitlePage({ character, apiBasePath }: ExtensionPageProps) {
  const [text, setText] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let socket: WebSocket | undefined;

    async function initialize() {
      try {
        const response = await fetch(
          `${apiBasePath}/settings?${new URLSearchParams({ characterId: character.id })}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`读取字幕连接配置失败：${response.status}`);
        }
        const settings: PageSettings = await response.json();
        controller.signal.throwIfAborted();
        const current = new WebSocket(settings.connection.url);
        socket = current;
        current.onopen = () => {
          current.send(
            JSON.stringify({ type: "hello", role: "observer", token: settings.connection.token }),
          );
        };
        current.onmessage = (message) => {
          const event: ServerMessage = JSON.parse(message.data);
          if (event.type === "subtitle") {
            setText(event.text);
          } else if (event.type === "error") {
            setText("");
            console.error("字幕展示页连接错误", event.message);
          }
        };
        current.onclose = () => setText("");
        current.onerror = () => {
          setText("");
          console.error("字幕展示页无法连接互动 agent，请在场景就绪后刷新页面。");
        };
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("字幕展示页初始化失败", error);
        }
      }
    }
    initialize();
    return () => {
      controller.abort();
      socket?.close();
    };
  }, [character.id, apiBasePath]);

  return (
    <div className="flex h-dvh w-full items-end justify-center overflow-hidden pb-16">
      {text && (
        <p
          className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-black/70 px-6 py-3 text-center text-[64px] font-bold leading-relaxed text-[#FFF8EE]"
          style={{
            textShadow: "0 2px 4px rgb(0 0 0 / 40%)",
          }}
        >
          {text}
        </p>
      )}
    </div>
  );
}
