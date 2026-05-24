"use client";

import type { Monaco } from "@monaco-editor/react";
import Editor from "@monaco-editor/react";

type MonacoEditorPanelProps = {
  value: string;
  language: string;
  readOnly: boolean;
  onChange: (value: string) => void;
};

const LOG_HIGHLIGHT_MAX_SIZE = 300 * 1024;

export const MonacoEditorPanel = ({
  value,
  language,
  readOnly,
  onChange,
}: MonacoEditorPanelProps) => {
  const effectiveLanguage =
    language === "log" && value.length > LOG_HIGHLIGHT_MAX_SIZE ? "plaintext" : language;

  const handleBeforeMount = (monaco: Monaco) => {
    const hasLogLanguage = monaco.languages.getLanguages().some((item) => item.id === "log");
    if (hasLogLanguage) {
      return;
    }

    monaco.languages.register({ id: "log" });
    monaco.languages.setMonarchTokensProvider("log", {
      tokenizer: {
        root: [
          [/^\[[^\]]+\]/, "number"],
          [/\[(debug|info|warn|error)\]/, "keyword"],
          [/\[[\w.-]+\]/, "type"],
          [/\bat\s+[^\n]+/, "string"],
          [/[{}[\](),.:]/, "delimiter"],
        ],
      },
    });
  };

  return (
    <div className="h-[calc(100vh-190px)] min-h-[480px] overflow-hidden rounded-xl border border-[#d5e4f4] bg-white shadow-[0_10px_20px_rgba(15,33,57,0.05)]">
      <Editor
        beforeMount={handleBeforeMount}
        height="100%"
        theme="vs"
        language={effectiveLanguage}
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        options={{
          readOnly,
          fontSize: 13,
          minimap: { enabled: false },
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
};
