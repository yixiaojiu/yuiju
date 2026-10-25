import { Button } from "@yuiju/shared/ui/components/button";
import { type OptionalToolName, optionalToolNames, type ScenePreparation } from "../protocol.ts";

const toolLabels: Record<OptionalToolName, string> = {
  observe_screen: "查看标签页画面",
  browser_action: "点击、输入与滚动",
  street_view: "街景探索",
};

/** 本次进入的输入草稿；只修改页面状态，不写入配置或提示词文件。 */
export function PreparationPanel({
  draft,
  editable,
  onChange,
}: {
  draft: ScenePreparation;
  editable: boolean;
  onChange(draft: ScenePreparation): void;
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-medium">本次场景输入</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.simulateSpeech}
          disabled={!editable}
          onChange={(event) => onChange({ ...draft, simulateSpeech: event.target.checked })}
        />
        静音模拟播放（不调用 TTS）
      </label>
      <p className="text-xs text-muted-foreground">
        仅对本次场景生效；模拟时按每字 0.2 秒播放字幕和动作，不发声，不验证真实嘴型。
      </p>
      <fieldset disabled={!editable} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">启用工具</legend>
        {optionalToolNames.map((name) => (
          <label key={name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabledTools.includes(name)}
              onChange={(event) =>
                onChange({
                  ...draft,
                  enabledTools: event.target.checked
                    ? [...draft.enabledTools, name]
                    : draft.enabledTools.filter((tool) => tool !== name),
                })
              }
            />
            <span>
              {toolLabels[name]}（{name}）
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          语音与表演（vtuber_act）、等待（wait）、结束（finish）固定启用。工具选择仅对本次场景生效。
        </p>
      </fieldset>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">场景预设</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={draft.sceneContent === "" ? "default" : "outline"}
            aria-pressed={draft.sceneContent === ""}
            disabled={!editable}
            onClick={() => onChange({ ...draft, sceneContent: "" })}
          >
            不使用预设
          </Button>
          {draft.scenePresets.map((preset) => (
            <Button
              key={preset.key}
              variant={draft.sceneContent === preset.content ? "default" : "outline"}
              aria-pressed={draft.sceneContent === preset.content}
              disabled={!editable}
              onClick={() => onChange({ ...draft, sceneContent: preset.content })}
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          选择预设会替换下方场景内容，可以继续编辑；不使用预设会清空场景内容。工具勾选保持不变。
        </p>
      </div>
      <label className="block space-y-2 text-sm">
        <span>场景内容</span>
        <textarea
          className="min-h-64 w-full rounded-lg border bg-background p-3 font-mono text-xs"
          placeholder="选择预设或直接填写本次场景的环境、能力与补充说明；留空时使用通用互动规则。"
          value={draft.sceneContent}
          readOnly={!editable}
          onChange={(event) => onChange({ ...draft, sceneContent: event.target.value })}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>通用互动提示词</span>
        <textarea
          className="min-h-64 w-full rounded-lg border bg-background p-3 font-mono text-xs"
          value={draft.scenePrompt}
          readOnly={!editable}
          onChange={(event) => onChange({ ...draft, scenePrompt: event.target.value })}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>主 agent 交接上下文</span>
        <textarea
          className="min-h-32 w-full rounded-lg border bg-background p-3 text-xs"
          value={draft.context}
          readOnly={!editable}
          onChange={(event) => onChange({ ...draft, context: event.target.value })}
        />
      </label>
      <details>
        <summary className="text-sm">公共人设（只读）</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
          {draft.persona}
        </pre>
      </details>
      <details>
        <summary className="text-sm">角色互动提示词（只读）</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
          {draft.characterPrompt}
        </pre>
      </details>
    </section>
  );
}
