"use client";

import { useEffect, useRef, useState } from "react";
import type { PixelActionName } from "../scene/pixel-actions";
import type { LightingPresetId } from "./stage/lit-lighting";
import { LitCafeStage } from "./stage/lit-stage";

export function PixelLitCafePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<LitCafeStage | null>(null);

  const [preset, setPreset] = useState<LightingPresetId>("afternoon");
  const [activeLoop, setActiveLoop] = useState<PixelActionName>("idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const stage = new LitCafeStage(container, setActiveLoop);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setPreset(preset);
  }, [preset]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0d0e16] select-none">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-200/15 bg-[#121018]/80 px-3.5 py-2 text-xs whitespace-nowrap text-amber-50 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => stageRef.current?.playOneShot("wave")}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-amber-100 transition hover:bg-amber-300/20"
          >
            挥手 (1)
          </button>
          <button
            type="button"
            onClick={() => stageRef.current?.playOneShot("bow")}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-amber-100 transition hover:bg-amber-300/20"
          >
            鞠躬 (2)
          </button>
          <button
            type="button"
            onClick={() => stageRef.current?.playOneShot("serve")}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-amber-100 transition hover:bg-amber-300/20"
          >
            上饮品 (3)
          </button>
          <button
            type="button"
            onClick={() => stageRef.current?.toggleStationaryLoop("wipe")}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 transition ${
              activeLoop === "wipe"
                ? "border-amber-300/50 bg-amber-300/25 text-amber-50"
                : "border-white/10 bg-white/5 text-amber-100 hover:bg-amber-300/20"
            }`}
          >
            擦杯子 (4)
          </button>
          <button
            type="button"
            onClick={() => stageRef.current?.showEmote("heart")}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-amber-100 transition hover:bg-amber-300/20"
          >
            爱心 (5)
          </button>
        </div>

        <div className="h-4 w-px bg-white/15" />

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
          {(
            [
              ["afternoon", "午后斜阳"],
              ["dusk", "暮色喫茶"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPreset(id)}
              className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
                preset === id
                  ? "bg-amber-300/25 font-medium text-amber-50"
                  : "text-amber-100/60 hover:text-amber-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="pl-1 text-[11px] text-amber-100/55">
          WASD 四向移动 · 3D 三渲二像素小人
        </span>
      </div>
    </div>
  );
}
