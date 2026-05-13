"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    require?: ((modules: string[], onLoad: (...args: unknown[]) => void) => void) & {
      config?: (options: { paths: Record<string, string> }) => void;
    };
    monaco?: {
      editor: {
        create: (element: HTMLElement, options: Record<string, unknown>) => MonacoEditorInstance;
      };
    };
  }
}

type MonacoEditorInstance = {
  dispose: () => void;
  getModel: () => { setValue: (value: string) => void } | null;
  onDidChangeModelContent: (listener: () => void) => { dispose: () => void };
  getValue: () => string;
};

const MONACO_LOADER_SRC = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";

const ensureMonacoReady = async () => {
  if (window.monaco?.editor) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      "script[data-monaco-loader='true']",
    );
    if (existingScript) {
      if (window.monaco?.editor) {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("加载 Monaco 脚本失败")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = MONACO_LOADER_SRC;
    script.async = true;
    script.dataset.monacoLoader = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("加载 Monaco 脚本失败"));
    document.head.appendChild(script);
  });

  await new Promise<void>((resolve, reject) => {
    if (!window.require?.config || !window.require) {
      reject(new Error("Monaco require loader 不可用"));
      return;
    }

    window.require.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
    });

    window.require(["vs/editor/editor.main"], () => resolve());
  });
};

type MonacoEditorPanelProps = {
  value: string;
  readOnly?: boolean;
  minHeightClassName?: string;
  onChange?: (nextValue: string) => void;
};

export function MonacoEditorPanel({
  value,
  readOnly = true,
  minHeightClassName = "min-h-[460px]",
  onChange,
}: MonacoEditorPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const onChangeRef = useRef<((nextValue: string) => void) | undefined>(onChange);
  const latestValueRef = useRef(value);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  onChangeRef.current = onChange;
  latestValueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    let contentChangeSubscription: { dispose: () => void } | null = null;

    const setupEditor = async () => {
      try {
        await ensureMonacoReady();
        if (cancelled || !containerRef.current || !window.monaco?.editor) {
          return;
        }

        editorRef.current = window.monaco.editor.create(containerRef.current, {
          value: latestValueRef.current,
          language: "plaintext",
          readOnly,
          minimap: { enabled: false },
          lineNumbersMinChars: 3,
          fontSize: 12,
          automaticLayout: true,
          scrollBeyondLastLine: false,
        });

        contentChangeSubscription = editorRef.current.onDidChangeModelContent(() => {
          const nextValue = editorRef.current?.getValue();
          if (typeof nextValue === "string") {
            onChangeRef.current?.(nextValue);
          }
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Monaco 初始化失败");
      }
    };

    setupEditor();

    return () => {
      cancelled = true;
      contentChangeSubscription?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    model?.setValue(value);
  }, [value]);

  if (errorMessage) {
    return (
      <div
        className={`h-full ${minHeightClassName} rounded-xl border border-[rgba(217,230,245,0.95)] bg-white/85 p-3 text-xs text-[#6b7480]`}
      >
        {errorMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`h-full ${minHeightClassName} rounded-xl border border-[rgba(217,230,245,0.95)]`}
    />
  );
}

type MonacoReadonlyProps = {
  value: string;
};

export function MonacoReadonly({ value }: MonacoReadonlyProps) {
  return <MonacoEditorPanel value={value} readOnly />;
}
