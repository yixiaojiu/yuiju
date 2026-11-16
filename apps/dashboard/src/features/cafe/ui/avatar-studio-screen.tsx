import { useEffect, useRef, useState } from "react";
import {
  AVATAR_PRESETS,
  type AvatarPreset,
  defaultAvatarConfig,
  findPreset,
  type StudioShot,
} from "../scene/avatar";
import { AvatarStudio } from "../scene/avatar-studio";
import type { LoadingProgress } from "../scene/stage";
import type { AvatarConfig } from "../session/state";

const SHOTS: { id: StudioShot; label: string }[] = [
  { id: "full", label: "全身" },
  { id: "half", label: "半身" },
  { id: "face", label: "脸" },
];

/** 白色在染色里表示原色。 */
const ORIGINAL_COLOR = "#ffffff";

function randomConfig(preset: AvatarPreset, name: string): AvatarConfig {
  const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
  return {
    presetId: preset.id,
    colors: Object.fromEntries(
      preset.parts.map((part) => [part.id, pick([ORIGINAL_COLOR, ...part.swatches])]),
    ),
    accessories: preset.accessories
      .filter(() => Math.random() < 0.5)
      .map((accessory) => accessory.id),
    name,
  };
}

/**
 * 捏人场景：左边是可以拖动旋转的角色预览，右边是编辑面板。所有改动实时反映在模型上。
 * 每次进店都会经过这里，再次来时预先填好上次的配置。
 * cafeProgress 是咖啡店的后台加载进度，加载完成后为 null。shopFull 为真时店里满席，不能进店。
 */
export function AvatarStudioScreen({
  initial,
  cafeProgress,
  shopFull,
  onConfirm,
}: {
  initial: AvatarConfig;
  cafeProgress: LoadingProgress | null;
  shopFull: boolean;
  onConfirm: (config: AvatarConfig, thumbnail: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<AvatarStudio | null>(null);
  const [config, setConfig] = useState(initial);
  const [shot, setShot] = useState<StudioShot>("full");
  const [customPart, setCustomPart] = useState<string | null>(null);
  const preset = findPreset(config.presetId);
  const nameMissing = !config.name.trim();

  useEffect(() => {
    const studio = new AvatarStudio(previewRef.current!);
    studioRef.current = studio;
    return () => {
      studio.dispose();
      studioRef.current = null;
    };
  }, []);

  // 配置一变就反映到模型上。
  useEffect(() => {
    studioRef.current!.show(config);
  }, [config]);

  useEffect(() => {
    studioRef.current!.setShot(shot);
  }, [shot]);

  function confirm() {
    onConfirm(config, studioRef.current!.captureThumbnail());
  }

  function setColor(partId: string, color: string, partShot: StudioShot) {
    setConfig({ ...config, colors: { ...config.colors, [partId]: color } });
    // 改哪个部位，镜头就转到能看清这个部位的位置。
    setShot(partShot);
  }

  return (
    <div className="absolute inset-0 z-10 flex bg-[radial-gradient(ellipse_at_35%_45%,#5a4232_0%,#2a1e16_55%,#140f0b_100%)]">
      <div className="relative flex-1">
        <div ref={previewRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
        <div className="pointer-events-none absolute top-8 left-10">
          <p className="text-xs tracking-[0.5em] text-[#e9b872]/70">喫 茶 · 薄暮咖啡</p>
          <h1 className="mt-2 text-2xl font-bold text-[#f3e9d6]">今天以什么样子去店里？</h1>
        </div>
        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
          <div className="flex gap-1 rounded-full bg-black/35 p-1 backdrop-blur">
            {SHOTS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setShot(item.id)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${shot === item.id ? "bg-[#f3e9d6] font-bold text-stone-800" : "text-white/75 hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/40">拖动旋转 · 滚轮缩放</p>
        </div>
      </div>

      <div className="flex w-[380px] flex-col bg-[#f3e9d6] shadow-2xl">
        <div className="flex-1 space-y-7 overflow-y-auto px-7 py-8">
          <section>
            <h2 className="mb-2 font-bold text-stone-800">她会怎么称呼你？</h2>
            <input
              value={config.name}
              maxLength={12}
              onChange={(event) => setConfig({ ...config, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  confirm();
                }
              }}
              placeholder="写下你的名字"
              className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-2.5 text-stone-800 transition-colors focus:border-[#e9b872] focus:outline-none"
            />
            <p className="mt-1.5 flex justify-between text-xs text-stone-400">
              <span>{nameMissing ? "起个名字，她才知道怎么叫你" : "她会这样叫你"}</span>
              <span>{config.name.length}/12</span>
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-stone-800">形象</h2>
            <div className="grid grid-cols-3 gap-2">
              {AVATAR_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setConfig(defaultAvatarConfig(item, config.name))}
                  className={`rounded-xl border-2 bg-white px-2 py-3 text-sm transition-colors ${item.id === preset.id ? "border-[#e9b872] font-bold text-stone-800" : "border-transparent text-stone-500 hover:border-[#e9b872]/50"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-bold text-stone-800">颜色</h2>
            <div className="space-y-4">
              {preset.parts.map((part) => {
                const current = config.colors[part.id];
                const isCustom = current !== ORIGINAL_COLOR && !part.swatches.includes(current);
                return (
                  <div key={part.id}>
                    <p className="mb-1.5 text-sm text-stone-600">{part.label}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Swatch
                        color={ORIGINAL_COLOR}
                        label="原色"
                        selected={current === ORIGINAL_COLOR}
                        onSelect={() => setColor(part.id, ORIGINAL_COLOR, part.shot)}
                      />
                      {part.swatches.map((color) => (
                        <Swatch
                          key={color}
                          color={color}
                          label={color}
                          selected={current === color}
                          onSelect={() => setColor(part.id, color, part.shot)}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => setCustomPart(customPart === part.id ? null : part.id)}
                        className={`h-8 rounded-full px-3 text-xs transition-colors ${isCustom || customPart === part.id ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-800"}`}
                      >
                        自定义
                      </button>
                    </div>
                    {customPart === part.id && (
                      <input
                        type="color"
                        value={current}
                        onChange={(event) => setColor(part.id, event.target.value, part.shot)}
                        className="mt-2 h-9 w-full cursor-pointer rounded-lg bg-white"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {preset.accessories.length > 0 && (
            <section>
              <h2 className="mb-2 font-bold text-stone-800">配饰</h2>
              <div className="flex flex-wrap gap-2">
                {preset.accessories.map((accessory) => {
                  const enabled = config.accessories.includes(accessory.id);
                  return (
                    <button
                      key={accessory.id}
                      type="button"
                      aria-pressed={enabled}
                      onClick={() => {
                        setConfig({
                          ...config,
                          accessories: enabled
                            ? config.accessories.filter((id) => id !== accessory.id)
                            : [...config.accessories, accessory.id],
                        });
                        setShot("half");
                      }}
                      className={`rounded-full border-2 px-4 py-1.5 text-sm transition-colors ${enabled ? "border-[#e9b872] bg-[#e9b872]/20 font-bold text-stone-800" : "border-stone-300 text-stone-500"}`}
                    >
                      {enabled ? "✓ " : ""}
                      {accessory.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="border-t border-stone-300/60 px-7 py-5">
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfig(randomConfig(preset, config.name))}
              className="flex-1 rounded-lg bg-white py-2 text-sm text-stone-600 hover:text-stone-800"
            >
              随机搭配
            </button>
            <button
              type="button"
              onClick={() => setConfig(defaultAvatarConfig(preset, config.name))}
              className="flex-1 rounded-lg bg-white py-2 text-sm text-stone-600 hover:text-stone-800"
            >
              恢复默认
            </button>
          </div>
          <button
            type="button"
            disabled={nameMissing || shopFull}
            onClick={confirm}
            className="w-full rounded-xl bg-[#e9b872] py-3 font-bold text-stone-800 shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:hover:scale-100"
          >
            {shopFull ? "满席，请稍后再来" : "就这样，去咖啡店"}
          </button>
          <p className="mt-2 text-center text-xs text-stone-400">
            {cafeProgress
              ? `咖啡店正在准备 ${Math.round(cafeProgress.fraction * 100)}%`
              : "咖啡店已经准备好了"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Swatch({
  color,
  label,
  selected,
  onSelect,
}: {
  color: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={`relative h-8 w-8 rounded-full border border-black/10 transition-transform hover:scale-110 ${selected ? "ring-2 ring-[#e9b872] ring-offset-2 ring-offset-[#f3e9d6]" : ""}`}
      style={{ backgroundColor: color }}
    >
      {color === ORIGINAL_COLOR && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-stone-400">
          原
        </span>
      )}
    </button>
  );
}
