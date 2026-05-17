"use client";

import Editor from "@monaco-editor/react";

type MonacoEditorPanelProps = {
  value: string;
  language: string;
  readOnly: boolean;
  onChange: (value: string) => void;
};

export const MonacoEditorPanel = ({
  value,
  language,
  readOnly,
  onChange,
}: MonacoEditorPanelProps) => {
  return (
    <div className="h-[calc(100vh-190px)] min-h-[480px] overflow-hidden rounded-xl border border-[#d5e4f4] bg-white shadow-[0_10px_20px_rgba(15,33,57,0.05)]">
      <Editor
        height="100%"
        theme="vs"
        language={language}
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
