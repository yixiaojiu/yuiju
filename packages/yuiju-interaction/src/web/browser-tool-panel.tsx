"use client";
import { Button } from "@yuiju/shared/ui/components/button";
import { useState } from "react";
import {
  type BrowserProgress,
  type BrowserTestCommand,
  type BrowserTestResult,
  browserTestCommandSchema,
} from "../protocol.ts";

export type BrowserToolTest = {
  id: string;
  running: boolean;
  progress: BrowserProgress[];
  result?: BrowserTestResult;
  error?: string;
};

export function BrowserToolPanel({
  available,
  test,
  onExecute,
}: {
  available: boolean;
  test?: BrowserToolTest;
  onExecute(command: BrowserTestCommand): void;
}) {
  const [method, setMethod] = useState<BrowserTestCommand["method"]>("street_view");
  const [input, setInput] = useState('{"type":"move","direction":"forward"}');
  const [error, setError] = useState("");
  const result = test?.result;
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-medium">浏览器工具测试</h2>
      <p className="text-xs text-muted-foreground">
        准备阶段直接操作已连接的标签页，不调用 LLM 或 TTS。执行失败后请先观察，不要重复移动。
      </p>
      <select
        aria-label="测试工具"
        className="w-full rounded-lg border bg-background p-2"
        value={method}
        disabled={test?.running}
        onChange={(event) => {
          const method = event.target.value as BrowserTestCommand["method"];
          setMethod(method);
          setInput(
            method === "observe"
              ? "{}"
              : method === "street_view"
                ? '{"type":"move","direction":"forward"}'
                : '{"type":"key","key":"Escape"}',
          );
        }}
      >
        <option value="street_view">street_view · 街景探索</option>
        <option value="observe">observe_screen · 观察画面</option>
        <option value="action">browser_action · 浏览器操作</option>
      </select>
      <textarea
        aria-label="工具参数 JSON"
        className="min-h-24 w-full rounded-lg border bg-background p-3 font-mono text-sm"
        value={input}
        disabled={test?.running}
        onChange={(event) => setInput(event.target.value)}
      />
      <Button
        disabled={!available || test?.running}
        onClick={() => {
          try {
            setError("");
            onExecute(browserTestCommandSchema.parse({ method, input: JSON.parse(input) }));
          } catch (error) {
            setError(String(error));
          }
        }}
      >
        {test?.running ? "执行中…" : "执行工具"}
      </Button>
      {!available && (
        <p className="text-xs text-muted-foreground">
          请在准备阶段连接 agent 和浏览器标签页后测试。
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
          {error}
        </p>
      )}
      {test && (
        <div className="space-y-2 text-sm">
          <p className="break-all text-xs text-muted-foreground">请求 ID：{test.id}</p>
          {test.error && (
            <p role="alert" className="text-destructive">
              {test.error}
            </p>
          )}
          {result && (
            <p>
              {result.result.ok ? "执行成功" : "执行失败"} · {result.durationMs} ms
            </p>
          )}
          {result && !result.result.ok && (
            <p role="alert" className="whitespace-pre-wrap text-destructive">
              {result.result.error}
            </p>
          )}
          <ol className="max-h-64 space-y-1 overflow-auto font-mono text-xs">
            {[...test.progress].reverse().map((progress, index) => (
              <li key={test.progress.length - index}>
                {progress.stage} ·{" "}
                {{ running: "开始", completed: "完成", failed: "失败" }[progress.state]}
                {progress.state !== "running" && ` · ${progress.durationMs} ms`}
                {progress.detail && ` · ${progress.detail}`}
              </li>
            ))}
          </ol>
          {result?.result.ok && (
            <>
              <p className="break-words">{result.result.screen.title}</p>
              {"orientation" in result.result.screen && (
                <p>
                  朝向：{result.result.screen.orientation.direction}（
                  {result.result.screen.orientation.heading.toFixed(1)}°） · 俯仰：
                  {result.result.screen.orientation.pitch.toFixed(1)}°（正数抬头）
                </p>
              )}
              <img
                alt="工具执行后的浏览器截图"
                className="w-full rounded-lg border"
                src={`data:image/jpeg;base64,${result.result.screen.image}`}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
