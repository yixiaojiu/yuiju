"use client";

import { useEffect, useRef, useState } from "react";
import { type OutfitName, outfitLabels } from "./character/character-design";
import type { PixelActionName } from "./character/pixel-actions";
import { LitCafeStage, type LitCameraState, type LitViewName } from "./stage/lit-stage";
import { LIT_PRESETS, type LightingPresetId, type LitTuning } from "./stage/lit-tuning";
import { LightingPanel } from "./ui/lighting-panel";

/** 进游戏时角色穿的衣服：咖啡馆营业，穿洛丽塔。 */
const INITIAL_OUTFIT: OutfitName = "lolita";

const viewLabels: Record<LitViewName, string> = {
  front: "正面",
  right: "右侧",
  back: "背面",
  left: "左侧",
};

export function PixelLitCafePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<LitCafeStage | null>(null);

  const [preset, setPreset] = useState<LightingPresetId>("afternoon");
  // 调光面板在当前预设的基础上实时修改；切换预设时载入那个预设的整套参数。
  const [tuning, setTuning] = useState<LitTuning>(LIT_PRESETS.afternoon);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeLoop, setActiveLoop] = useState<PixelActionName>("idle");
  const [outfit, setOutfit] = useState<OutfitName>(INITIAL_OUTFIT);
  const [camera, setCamera] = useState<LitCameraState>({ view: "front", elevation: 30 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const stage = new LitCafeStage(container, INITIAL_OUTFIT, setActiveLoop, setCamera);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.applyTuning(tuning);
  }, [tuning]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0d0e16] select-none">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute top-4 right-4 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          className="pointer-events-auto cursor-pointer rounded-lg border border-amber-200/15 bg-[#121018]/80 px-3 py-1.5 text-xs text-amber-50 backdrop-blur-md hover:bg-amber-300/20"
        >
          {panelOpen ? "收起调光" : "调光"}
        </button>
        {panelOpen && (
          <LightingPanel
            tuning={tuning}
            onChange={setTuning}
            onReset={() => setTuning(LIT_PRESETS[preset])}
          />
        )}
      </div>

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
          {(Object.keys(outfitLabels) as OutfitName[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setOutfit(name);
                stageRef.current?.setOutfit(name);
              }}
              className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
                outfit === name
                  ? "bg-amber-300/25 font-medium text-amber-50"
                  : "text-amber-100/60 hover:text-amber-50"
              }`}
            >
              {outfitLabels[name]}
            </button>
          ))}
        </div>

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
              onClick={() => {
                setPreset(id);
                setTuning(LIT_PRESETS[id]);
              }}
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

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            type="button"
            onClick={() => stageRef.current?.rotateView(-1)}
            className="cursor-pointer rounded-md px-2 py-1 text-amber-100/80 transition hover:text-amber-50"
          >
            ⟲ Q
          </button>
          <span className="min-w-8 text-center text-amber-50">{viewLabels[camera.view]}</span>
          <button
            type="button"
            onClick={() => stageRef.current?.rotateView(1)}
            className="cursor-pointer rounded-md px-2 py-1 text-amber-100/80 transition hover:text-amber-50"
          >
            E ⟳
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            type="button"
            onClick={() => stageRef.current?.tiltView(-1)}
            className="cursor-pointer rounded-md px-2 py-1 text-amber-100/80 transition hover:text-amber-50"
          >
            F ▽
          </button>
          <span className="min-w-8 text-center text-amber-50">{camera.elevation}°</span>
          <button
            type="button"
            onClick={() => stageRef.current?.tiltView(1)}
            className="cursor-pointer rounded-md px-2 py-1 text-amber-100/80 transition hover:text-amber-50"
          >
            △ R
          </button>
        </div>

        <span className="pl-1 text-[11px] text-amber-100/55">
          WASD 四向移动 · QE 转视角 · RF 俯视角 · 3D 三渲二像素小人
        </span>
      </div>
    </div>
  );
}
