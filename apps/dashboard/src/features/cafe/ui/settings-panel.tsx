import type { PlayerSettings } from "../profile";
import { Modal } from "./panels";

/** 设置面板：鼠标灵敏度、画质、是否显示操作提示。改动立即生效并保存。 */
export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: PlayerSettings;
  onChange: (settings: PlayerSettings) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="设置" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-bold text-stone-800">鼠标灵敏度</span>
            <span className="text-stone-500">{settings.mouseSensitivity.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.1}
            value={settings.mouseSensitivity}
            onChange={(event) =>
              onChange({ ...settings, mouseSensitivity: Number(event.target.value) })
            }
            className="w-full accent-[#c8955a]"
          />
          <div className="flex justify-between text-xs text-stone-400">
            <span>慢</span>
            <span>快</span>
          </div>
        </section>

        <section>
          <p className="mb-2 text-sm font-bold text-stone-800">画质</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "high", label: "高", hint: "完整的光晕效果" },
                { id: "standard", label: "标准", hint: "更流畅，适合配置较低的电脑" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={settings.quality === option.id}
                onClick={() => onChange({ ...settings, quality: option.id })}
                className={`rounded-xl border-2 bg-white px-3 py-2.5 text-left transition-colors ${settings.quality === option.id ? "border-[#e9b872]" : "border-transparent"}`}
              >
                <span className="block text-sm font-bold text-stone-800">{option.label}</span>
                <span className="block text-xs text-stone-500">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-between">
          <span className="text-sm font-bold text-stone-800">显示操作提示</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.showControlsHint}
            onClick={() => onChange({ ...settings, showControlsHint: !settings.showControlsHint })}
            className={`relative h-6 w-11 rounded-full transition-colors ${settings.showControlsHint ? "bg-[#e9b872]" : "bg-stone-300"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.showControlsHint ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </section>
      </div>
    </Modal>
  );
}
