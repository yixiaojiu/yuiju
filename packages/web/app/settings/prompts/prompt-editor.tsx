"use client";

import type { PromptCustomizationKey } from "@yuiju/utils/types/prompt-customization";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MonacoEditorPanel } from "@/app/file-browser/monaco-editor-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PromptCustomizationPayload } from "@/lib/api/prompts";
import { usePromptCustomizations } from "./use-prompt-customizations";

const promptLabels: Record<PromptCustomizationKey, { label: string; description: string }> = {
  character: {
    label: "角色",
    description: "角色身份、背景与稳定人物事实。",
  },
  world: {
    label: "世界观",
    description: "完整世界观，包括跨世界边界、人物事实、地点与设备说明。",
  },
  chat: {
    label: "聊天",
    description: "聊天参与方式、表达风格、关系处理与回复倾向。",
  },
  chatBehavior: {
    label: "聊天 Planner",
    description: "实验群聊链路的参与判断、注意力延续和行动选择。",
  },
  chatReply: {
    label: "聊天 Replyer",
    description: "实验群聊链路最终可见消息的口吻、粒度和表达边界。",
  },
  chooseAction: {
    label: "ChooseAction",
    description: "生活节奏、状态优先级、消费态度与行动决策倾向。",
  },
  diary: {
    label: "日记",
    description: "每日日记的叙事风格与完整写作规则，调用处已包含角色提示词。",
  },
};

export function PromptEditor() {
  const {
    data: payload,
    error,
    isLoading,
    isMutating,
    savePromptCustomization,
    restoreDefaultPrompt,
  } = usePromptCustomizations();
  const [selectedKey, setSelectedKey] = useState<PromptCustomizationKey>("character");
  const [drafts, setDrafts] = useState<Partial<Record<PromptCustomizationKey, string>>>({});
  const draftsInitialized = useRef(false);

  useEffect(() => {
    if (payload && !draftsInitialized.current) {
      setDrafts(Object.fromEntries(payload.items.map((item) => [item.key, item.content])));
      draftsInitialized.current = true;
    }
  }, [payload]);

  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : "读取提示词失败");
    }
  }, [error]);

  const selectedItem = payload?.items.find((item) => item.key === selectedKey);
  const draft = drafts[selectedKey] ?? "";
  const hasChanges = selectedItem ? draft !== selectedItem.content : false;

  const applyPayload = (
    nextPayload: PromptCustomizationPayload,
    changedKey: PromptCustomizationKey,
  ) => {
    const changedItem = nextPayload.items.find((item) => item.key === changedKey);
    if (changedItem) {
      setDrafts((current) => ({ ...current, [changedKey]: changedItem.content }));
    }
  };

  const save = async () => {
    if (!draft.trim()) {
      toast.error("提示词内容不能为空");
      return;
    }

    try {
      const data = await savePromptCustomization(selectedKey, draft);
      applyPayload(data, selectedKey);
      toast.success("提示词已保存，下一次调用生效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存提示词失败");
    }
  };

  const restoreDefault = async () => {
    if (!window.confirm(`确定恢复“${promptLabels[selectedKey].label}”的代码默认提示词吗？`)) {
      return;
    }

    try {
      const data = await restoreDefaultPrompt(selectedKey);
      applyPayload(data, selectedKey);
      toast.success("已恢复代码默认提示词");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复默认提示词失败");
    }
  };

  return (
    <main className="min-h-[calc(100vh-78px)] bg-[#f7fbff] px-4 py-8 text-[#2b2f36] sm:px-6">
      <div className="mx-auto max-w-300">
        <header className="flex flex-col gap-4 border-b border-[#d9e6f5] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">提示词管理</h1>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={
                isLoading || isMutating || (!hasChanges && selectedItem?.source !== "override")
              }
              onClick={restoreDefault}
            >
              <RotateCcw aria-hidden="true" />
              恢复默认
            </Button>
            <Button
              type="button"
              disabled={isLoading || isMutating || !hasChanges || !draft.trim()}
              onClick={save}
            >
              <Save aria-hidden="true" />
              {isMutating ? "保存中" : "保存覆盖"}
            </Button>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {(Object.keys(promptLabels) as PromptCustomizationKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  selectedKey === key
                    ? "border-[#91c4ee] bg-[#eaf5ff]"
                    : "border-[#d9e6f5] bg-white hover:border-[#b8d7ef]"
                }`}
              >
                <span className="text-sm font-bold">{promptLabels[key].label}</span>
                <span className="mt-1 block text-xs leading-5 text-[#7d8997]">
                  {promptLabels[key].description}
                </span>
              </button>
            ))}
          </aside>

          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{promptLabels[selectedKey].label}</h2>
                {selectedItem ? (
                  <Badge variant="soft" size="xs">
                    {selectedItem.source === "default" ? "代码默认" : "MongoDB 覆盖"}
                  </Badge>
                ) : null}
                {hasChanges ? <Badge>未保存</Badge> : null}
              </div>
              <span className="text-xs text-[#8a95a2]">
                {selectedItem?.updatedAt
                  ? `更新于 ${new Date(selectedItem.updatedAt).toLocaleString("zh-CN")}`
                  : "尚未覆盖"}
              </span>
            </div>
            <MonacoEditorPanel
              value={draft}
              language="markdown"
              readOnly={isLoading}
              onChange={(content) =>
                setDrafts((current) => ({ ...current, [selectedKey]: content }))
              }
            />
          </section>
        </div>
      </div>
    </main>
  );
}
