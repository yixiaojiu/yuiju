"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";

/** 人物 JSON、记忆正文与日志共用只读编辑器，搜索、选择和复制交给 Monaco。 */
export function MonacoEditorPanel({
  value,
  language,
  follow = false,
}: {
  value: string;
  language: "json" | "markdown" | "log";
  follow?: boolean;
}) {
  const editor = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => {
    if (follow && value.length > 0 && editor.current) {
      editor.current.revealLine(editor.current.getModel()!.getLineCount());
    }
  }, [value, follow]);
  function registerLogLanguage(monaco: typeof Monaco) {
    if (!monaco.languages.getLanguages().some((item) => item.id === "log")) {
      monaco.languages.register({ id: "log" });
      monaco.languages.setMonarchTokensProvider("log", {
        tokenizer: {
          root: [
            [/^\[[^\]]+\]/, "number"],
            [/\[(info|warn|error|debug)\]/, "keyword"],
            [/\bat\s+[^\n]+/, "string"],
            [/[{}[\](),.:]/, "delimiter"],
          ],
        },
      });
    }
  }
  return (
    <div className="h-[calc(100dvh-220px)] min-h-[480px] min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <Editor
        height="100%"
        theme="vs"
        language={language}
        value={value}
        beforeMount={registerLogLanguage}
        onMount={(instance) => {
          editor.current = instance;
          if (follow) {
            instance.revealLine(instance.getModel()!.getLineCount());
          }
        }}
        loading={<span className="text-sm text-muted-foreground">加载中…</span>}
        options={{
          readOnly: true,
          domReadOnly: true,
          fontSize: 13,
          minimap: { enabled: false },
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
