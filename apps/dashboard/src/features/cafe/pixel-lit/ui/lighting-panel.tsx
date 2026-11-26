import { useState } from "react";
import type { LitTuning, RenderMode, ToneMappingName } from "../stage/lit-tuning";

type NumberKey = {
  [Key in keyof LitTuning]: LitTuning[Key] extends number ? Key : never;
}[keyof LitTuning];
type ColorKey = {
  [Key in keyof LitTuning]: LitTuning[Key] extends string ? Key : never;
}[Exclude<keyof LitTuning, "toneMapping" | "renderMode">];

/** 面板上的分组：每组若干滑杆和颜色。 */
const groups: {
  title: string;
  sliders: { key: NumberKey; label: string; min: number; max: number; step: number }[];
  colors: { key: ColorKey; label: string }[];
}[] = [
  {
    title: "画面",
    sliders: [
      { key: "exposure", label: "曝光", min: 0.4, max: 2, step: 0.01 },
      { key: "bloomStrength", label: "泛光强度", min: 0, max: 1.5, step: 0.01 },
      { key: "bloomRadius", label: "泛光半径", min: 0, max: 1, step: 0.01 },
      { key: "bloomThreshold", label: "泛光阈值", min: 0, max: 3, step: 0.01 },
      { key: "saturation", label: "饱和度", min: 0.5, max: 1.6, step: 0.01 },
      { key: "vignette", label: "四周压暗", min: 0, max: 0.8, step: 0.01 },
    ],
    colors: [{ key: "background", label: "背景" }],
  },
  {
    title: "环境光",
    sliders: [
      { key: "hemiIntensity", label: "天光", min: 0, max: 1.5, step: 0.01 },
      { key: "ambientIntensity", label: "环境光", min: 0, max: 1.5, step: 0.01 },
    ],
    colors: [
      { key: "hemiSky", label: "天光上" },
      { key: "hemiGround", label: "天光下" },
      { key: "ambientColor", label: "环境光" },
    ],
  },
  {
    title: "窗户",
    sliders: [
      { key: "windowLightIntensity", label: "窗光", min: 0, max: 10, step: 0.1 },
      { key: "windowBackdropIntensity", label: "窗户亮度", min: 0, max: 4, step: 0.01 },
      { key: "shaftStrength", label: "光柱", min: 0, max: 0.6, step: 0.01 },
    ],
    colors: [
      { key: "windowLightColor", label: "窗光" },
      { key: "windowBackdropColor", label: "窗户" },
      { key: "shaftColor", label: "光柱" },
    ],
  },
  {
    title: "灯具",
    sliders: [
      { key: "pendantIntensity", label: "吊灯和补光", min: 0, max: 4, step: 0.01 },
      { key: "coneStrength", label: "灯下光锥", min: 0, max: 0.3, step: 0.005 },
      { key: "shadowSoftness", label: "阴影柔和", min: 0, max: 6, step: 0.1 },
      { key: "dustStrength", label: "浮尘", min: 0, max: 1, step: 0.01 },
    ],
    colors: [],
  },
  {
    title: "角色受光",
    sliders: [
      { key: "characterLightStrength", label: "受光强度", min: 0, max: 3, step: 0.01 },
      { key: "characterMinLight", label: "最低亮度", min: 0, max: 1, step: 0.01 },
      { key: "characterMaxLight", label: "最高亮度", min: 0.5, max: 3, step: 0.01 },
      { key: "characterBands", label: "明暗分档", min: 0, max: 6, step: 1 },
      { key: "characterContactShadow", label: "脚下阴影", min: 0, max: 1, step: 0.01 },
    ],
    colors: [],
  },
];

const toneMappings: [ToneMappingName, string][] = [
  ["neutral", "Neutral"],
  ["aces", "ACES"],
  ["agx", "AgX"],
];
const renderModes: [RenderMode, string][] = [
  ["full", "全分辨率"],
  ["pixel", "像素网格"],
];

const chip = "rounded-md px-2 py-0.5 transition";
const chipOn = "bg-amber-300/25 text-amber-50";
const chipOff = "text-amber-100/60 hover:text-amber-50";

/**
 * 调光面板：实时修改调光参数。调满意后点「复制参数」，把 JSON 发给开发者写回预设。
 */
export function LightingPanel({
  tuning,
  onChange,
  onReset,
}: {
  tuning: LitTuning;
  onChange: (tuning: LitTuning) => void;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const set = <Key extends keyof LitTuning>(key: Key, value: LitTuning[Key]) =>
    onChange({ ...tuning, [key]: value });

  return (
    <div className="pointer-events-auto flex max-h-[calc(100dvh-7rem)] w-72 flex-col gap-3 overflow-y-auto rounded-xl border border-amber-200/15 bg-[#121018]/85 p-3 text-xs text-amber-50 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">调光</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(JSON.stringify(tuning, null, 2));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 hover:bg-amber-300/20"
          >
            {copied ? "已复制" : "复制参数"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 hover:bg-amber-300/20"
          >
            重置
          </button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-amber-100/70">渲染</span>
          <div className="flex gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            {renderModes.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => set("renderMode", mode)}
                className={`${chip} ${tuning.renderMode === mode ? chipOn : chipOff}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-amber-100/70">色调映射</span>
          <div className="flex gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            {toneMappings.map(([mapping, label]) => (
              <button
                key={mapping}
                type="button"
                onClick={() => set("toneMapping", mapping)}
                className={`${chip} ${tuning.toneMapping === mapping ? chipOn : chipOff}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.title} className="grid gap-1.5 border-t border-white/10 pt-2">
          <h3 className="text-amber-100/70">{group.title}</h3>
          {group.sliders.map(({ key, label, min, max, step }) => (
            <label key={key} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={tuning[key]}
                onChange={(event) => set(key, event.target.valueAsNumber)}
                className="h-3 accent-amber-300"
              />
              <output className="text-right font-mono tabular-nums text-amber-100/70">
                {tuning[key].toFixed(2)}
              </output>
            </label>
          ))}
          {group.colors.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {group.colors.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={tuning[key]}
                    onChange={(event) => set(key, event.target.value)}
                    className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
                  />
                  <span className="text-amber-100/70">{label}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
