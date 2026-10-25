"use client";
import type { SceneStatus } from "@yuiju/shared/extension/scene-requests";
import type { ExtensionPageProps } from "@yuiju/shared/extension/web";
import { Button } from "@yuiju/shared/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";
import { useEffect, useRef, useState } from "react";
import type {
  AgentActivity,
  CompressionStatus,
  ContextUsage,
  ModelUsage,
  ScenePreparation,
  Screen,
  ToolExecution,
} from "../protocol.ts";
import { BrowserToolPanel, type BrowserToolTest } from "./browser-tool-panel.tsx";
import { loadCubismCore } from "./live2d/load-core.ts";
import type { Live2DStage } from "./live2d/stage.ts";
import type { PerformanceStatus } from "./performance.ts";
import { PreparationPanel } from "./preparation-panel.tsx";
import { InteractionSession, type PageSettings, type PageUpdate } from "./session.ts";

const activityLabels: Record<AgentActivity["state"], string> = {
  preparing: "准备模型请求",
  model: "请求模型中",
  tools: "执行工具中",
  waiting: "定时等待",
  performance: "等待表演完成",
  paused: "已暂停",
  compressing: "等待压缩释放上下文",
  ended: "已结束",
  failed: "运行失败",
};
const compressionLabels: Record<CompressionStatus["state"], string> = {
  running: "后台压缩中",
  ready: "摘要待应用",
  applied: "摘要已应用",
  failed: "压缩失败",
  cancelled: "压缩已取消",
};
const performanceLabels: Record<PerformanceStatus["state"], string> = {
  idle: "空闲",
  tts: "生成语音中",
  playing: "语音播放中",
  action: "动作执行中",
  interrupted: "已打断",
  failed: "表演失败",
};
const toolLabels: Record<ToolExecution["state"], string> = {
  running: "开始",
  completed: "完成",
  failed: "失败",
  cancelled: "取消",
};

export function InteractionPage({ character, apiBasePath }: ExtensionPageProps) {
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<InteractionSession | null>(null);
  const audioUrls = useRef<string[]>([]);
  const preparation = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState<PageSettings>();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("disconnected");
  const [browserConnected, setBrowserConnected] = useState(false);
  const [connectionMode, setConnectionMode] = useState("");
  const [draft, setDraft] = useState<ScenePreparation>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [entryError, setEntryError] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [testSubtitle, setTestSubtitle] = useState("");
  const [browserTest, setBrowserTest] = useState<BrowserToolTest>();
  const [screen, setScreen] = useState<Screen>();
  const [listening, setListening] = useState(false);
  const [records, setRecords] = useState<{ text: string; url: string }[]>([]);
  const [events, setEvents] = useState<{ at: number; title: string; detail?: string }[]>([]);
  const [activity, setActivity] = useState<AgentActivity>();
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [modelUsage, setModelUsage] = useState<ModelUsage>();
  const [compression, setCompression] = useState<CompressionStatus>();
  const [performanceStatus, setPerformanceStatus] = useState<PerformanceStatus>();
  const [tools, setTools] = useState<ToolExecution[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    let disposed = false;
    let stage: Live2DStage | undefined;
    let current: InteractionSession | undefined;
    let script: HTMLScriptElement | undefined;
    const controller = new AbortController();
    function publish(update: PageUpdate) {
      if (disposed) {
        return;
      }
      if (update.type === "status" && "phase" in update) {
        setPhase(update.phase);
        setBrowserConnected(update.browserConnected);
        if (update.phase !== "running") {
          setListening(false);
        }
        if (update.phase === "disconnected" || update.phase === "closed") {
          setBrowserTest((test) =>
            test?.running
              ? {
                  ...test,
                  running: false,
                  error: "连接已断开，操作可能已执行，请重新连接后观察画面。",
                }
              : test,
          );
          setSubtitle("");
          setTools([]);
        }
      } else if (update.type === "browser_test_result") {
        setBrowserTest((test) =>
          test?.id === update.id ? { ...test, running: false, result: update } : test,
        );
      } else if (update.type === "browser_progress") {
        setBrowserTest((test) =>
          test?.id === update.id ? { ...test, progress: [...test.progress, update] } : test,
        );
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: Date.now(),
            title: `浏览器 · ${update.stage} · ${{ running: "开始", completed: "完成", failed: "失败" }[update.state]}`,
            detail: `请求 ${update.id} · ${update.durationMs} ms${update.detail ? ` · ${update.detail}` : ""}`,
          },
        ]);
      } else if (update.type === "agent_activity") {
        setActivity(update);
        setNow(Date.now());
        if (["paused", "ended", "failed"].includes(update.state)) {
          setTools([]);
        }
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: update.at,
            title: `Agent · ${activityLabels[update.state]} · 第 ${update.round} 轮`,
            detail: update.detail,
          },
        ]);
      } else if (update.type === "context_usage") {
        setContextUsage(update);
      } else if (update.type === "model_usage") {
        setModelUsage(update);
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: update.at,
            title: `模型请求完成 · ${(update.durationMs / 1000).toFixed(1)} 秒`,
            detail: `输入 ${update.inputTokens ?? "未提供"} / 输出 ${update.outputTokens ?? "未提供"} / 缓存命中 ${update.cacheReadTokens ?? "未提供"} token`,
          },
        ]);
      } else if (update.type === "compression_status") {
        setCompression(update);
        setEvents((events) => [
          ...events.slice(-99),
          { at: update.at, title: compressionLabels[update.state], detail: update.detail },
        ]);
      } else if (update.type === "tool_execution") {
        setTools((tools) =>
          update.state === "running"
            ? [...tools, update]
            : tools.filter((tool) => tool.id !== update.id),
        );
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: update.at,
            title: `${update.name} · ${toolLabels[update.state]}${update.durationMs === undefined ? "" : ` · ${(update.durationMs / 1000).toFixed(1)} 秒`}`,
            detail: update.detail,
          },
        ]);
      } else if (update.type === "performance_status") {
        setPerformanceStatus(update);
        setNow(Date.now());
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: update.at,
            title: `表演 · ${performanceLabels[update.state]}`,
            detail: update.detail,
          },
        ]);
      } else if (update.type === "preparation") {
        setDraft(update.preparation);
      } else if (update.type === "audio") {
        const url = URL.createObjectURL(update.audio);
        audioUrls.current.push(url);
        setRecords((records) => [...records, { text: update.text, url }]);
      } else if (update.type === "screen") {
        setScreen(update.screen);
      } else if (update.type === "subtitle") {
        setSubtitle(update.text);
      } else if (update.type === "error") {
        setError("text" in update ? update.text : update.message);
        setEvents((events) => [
          ...events.slice(-99),
          {
            at: Date.now(),
            title: "错误",
            detail: "text" in update ? update.text : update.message,
          },
        ]);
      } else {
        const detail =
          update.type === "trace"
            ? `${update.name}：${update.detail}`
            : "text" in update
              ? update.text
              : update.type;
        setEvents((events) => [
          ...events.slice(-99),
          { at: Date.now(), title: update.type, detail },
        ]);
      }
    }
    async function initialize() {
      try {
        const response = await fetch(
          `${apiBasePath}/settings?${new URLSearchParams({ characterId: character.id })}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`读取互动配置失败：${response.status}`);
        }
        const settings: PageSettings = await response.json();
        if (disposed) {
          return;
        }
        setSettings(settings);
        script = await loadCubismCore(controller.signal);
        if (disposed) {
          return;
        }
        const { createStage } = await import("./live2d/stage.ts");
        if (disposed) {
          return;
        }
        stage = await createStage(
          container.current!,
          `${apiBasePath}/${settings.modelPath}`,
          settings.expressions,
          {
            mode: "control",
            publishFrame: (frame) => current?.publishFrame(frame),
          },
        );
        if (disposed) {
          stage.destroy();
          return;
        }
        current = new InteractionSession(apiBasePath, character.id, settings, stage, publish);
        session.current = current;
        setReady(true);
      } catch (error) {
        if (!disposed) {
          setError(String(error));
        }
      }
    }
    initialize();
    return () => {
      disposed = true;
      controller.abort();
      preparation.current?.abort();
      script?.remove();
      current?.dispose();
      stage?.destroy();
      session.current = null;
      for (const url of audioUrls.current) {
        URL.revokeObjectURL(url);
      }
      audioUrls.current = [];
    };
  }, [apiBasePath, character.id]);

  /** 准备命令只发送一次；轮询仅查询入口是否就绪，不重新创建场景。 */
  async function prepare() {
    setDraft(undefined);
    if (connectionMode === "standalone") {
      await connect();
      return;
    }
    const controller = new AbortController();
    preparation.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]);
    try {
      setError("");
      setPhase("preparing");
      const query = new URLSearchParams({ characterId: character.id });
      const response = await fetch(`${apiBasePath}/scene?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      let status: SceneStatus = await response.json();
      query.set("sessionId", status.sessionId);
      while (!status.ready) {
        if (status.phase === "exiting") {
          throw new Error("场景正在退出，请检查角色日志");
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        signal.throwIfAborted();
        const response = await fetch(`${apiBasePath}/scene?${query}`, { signal });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        status = await response.json();
      }
      signal.throwIfAborted();
      await connect();
    } catch (error) {
      if (!controller.signal.aborted) {
        setPhase("disconnected");
        setError(String(error));
      }
    } finally {
      preparation.current = null;
    }
  }

  async function connect() {
    try {
      setError("");
      setActivity(undefined);
      setContextUsage(undefined);
      setModelUsage(undefined);
      setCompression(undefined);
      setPerformanceStatus(undefined);
      setTools([]);
      setEvents([]);
      setPhase("connecting");
      await session.current!.connect();
    } catch (error) {
      setPhase("disconnected");
      setError(String(error));
    }
  }
  function send() {
    try {
      session.current!.send({ type: "event", event: { type: "message", text } });
      setEvents((events) => [...events.slice(-99), { at: Date.now(), title: "你", detail: text }]);
      setText("");
    } catch (error) {
      setError(String(error));
    }
  }
  function sendTestSubtitle(value: string) {
    try {
      session.current!.send({ type: "subtitle", text: value });
      setSubtitle(value);
    } catch (error) {
      setError(String(error));
    }
  }
  function enter() {
    if (browserTest?.running) {
      setEntryError("浏览器工具测试正在执行，请等待结束后再进入场景。");
      return;
    }
    if (phase !== "waiting_entry") {
      if (phase === "entering") {
        setEntryError("正在进入场景，请稍候。");
      } else if (phase === "preparing") {
        setEntryError("场景准备中，请稍候。");
      } else if (phase === "connecting") {
        setEntryError("正在连接 agent，请稍候。");
      } else {
        setEntryError("请先选择连接方式，并连接 agent 或准备场景。");
      }
      return;
    }
    if (!draft) {
      setEntryError("尚未收到场景准备信息，请稍候。");
      return;
    }
    const missing: string[] = [];
    if (!browserConnected) {
      missing.push("请通过浏览器扩展连接目标标签页。");
    }
    if (!draft.scenePrompt.trim()) {
      missing.push("请填写场景提示词。");
    }
    if (missing.length > 0) {
      setEntryError(missing.join("\n"));
      return;
    }
    try {
      setEntryError("");
      setError("");
      session.current!.enter({
        type: "enter",
        scenePrompt: draft.scenePrompt,
        sceneContent: draft.sceneContent,
        context: draft.context,
        enabledTools: draft.enabledTools,
        simulateSpeech: draft.simulateSpeech,
      });
    } catch (error) {
      setEntryError(String(error));
    }
  }
  const labels: Record<string, string> = {
    disconnected: "未连接",
    preparing: "等待角色准备",
    connecting: "连接中",
    waiting_entry: "等待进入",
    entering: "准备中",
    running: "互动中",
    closed: "已结束",
  };
  const running = phase === "running";
  const disconnected = phase === "disconnected" || phase === "closed";
  const connected = ["waiting_entry", "entering", "running"].includes(phase);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="relative flex min-w-0 flex-col gap-4">
        {/* 切换阶段只调整预览尺寸，保留同一模型实例与帧同步。 */}
        <div className="relative rounded-2xl border bg-card">
          <div className="absolute left-4 top-4 text-sm">
            {character.name} · {labels[phase]}
            {running && draft?.simulateSpeech && " · 静音模拟（不发声）"}
          </div>
          <div ref={container} className={running ? "h-72" : "h-[60vh] min-h-96"} />
          {subtitle && (
            <p className="absolute inset-x-4 bottom-4 rounded-xl bg-background/90 p-3 text-center">
              {subtitle}
            </p>
          )}
        </div>
        {screen && (
          <div className="rounded-2xl border bg-card p-3">
            <p className="mb-2 text-sm">{screen.title}</p>
            <img
              src={`data:image/jpeg;base64,${screen.image}`}
              alt="角色最近看到的目标画面"
              className="w-full rounded-lg"
            />
          </div>
        )}
        <details className="rounded-2xl border bg-card p-4" open>
          <summary>运行过程（最近 100 条）</summary>
          <div
            className={`mt-3 space-y-2 overflow-auto text-xs ${running ? "max-h-[70vh]" : "max-h-96"}`}
          >
            {events
              .map((event, index) => (
                <details key={`${event.at}-${index}`} className="rounded-lg bg-muted p-2">
                  <summary className="break-words">
                    {new Date(event.at).toLocaleTimeString()} · {event.title}
                  </summary>
                  {event.detail && (
                    <pre className="mt-2 whitespace-pre-wrap break-words">{event.detail}</pre>
                  )}
                </details>
              ))
              .reverse()}
          </div>
        </details>
      </div>
      <div className="min-w-0 space-y-4">
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <h1 className="font-medium">
            {character.name} · {running ? "运行阶段" : "设置阶段"}
          </h1>
          {!running && (
            <>
              <Select
                value={connectionMode}
                onValueChange={setConnectionMode}
                disabled={!disconnected}
              >
                <SelectTrigger className="w-full" aria-label="连接方式">
                  <SelectValue placeholder="选择连接方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">独立调试</SelectItem>
                  <SelectItem value="character">角色场景</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!ready || !disconnected || !connectionMode} onClick={prepare}>
                  {connectionMode === "standalone" ? "连接独立 agent" : "准备场景"}
                </Button>
                {connectionMode === "character" && (
                  <Button
                    variant="outline"
                    disabled={!ready || !["disconnected", "closed"].includes(phase)}
                    onClick={connect}
                  >
                    连接已准备场景
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={!settings}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(settings!.connection));
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  复制浏览器连接信息
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const path = `/standalone/extensions/yuiju-interaction/${encodeURIComponent(character.id)}/live2d`;
                      await navigator.clipboard.writeText(
                        new URL(path, window.location.origin).href,
                      );
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  复制 Live2D 地址
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const path = `/standalone/extensions/yuiju-interaction/${encodeURIComponent(character.id)}/subtitle`;
                      await navigator.clipboard.writeText(
                        new URL(path, window.location.origin).href,
                      );
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  复制字幕地址
                </Button>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {browserConnected ? "目标标签页已连接" : "等待浏览器扩展连接目标标签页"}
          </p>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
        {running && (
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  session.current!.send({ type: "event", event: { type: "interrupt" } })
                }
              >
                打断
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  session.current!.send({ type: "event", event: { type: "continue" } })
                }
              >
                继续
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  session.current!.send({
                    type: "event",
                    event: { type: "exit", reason: "用户结束互动" },
                  })
                }
              >
                结束
              </Button>
            </div>
            <textarea
              aria-label="插话内容"
              className="w-full rounded-lg border bg-background p-3"
              placeholder="说点什么…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex gap-2">
              <Button disabled={!text.trim()} onClick={send}>
                发送
              </Button>
              <Button
                variant="outline"
                disabled={!settings?.asrAvailable}
                onClick={async () => {
                  try {
                    await session.current!.listen(!listening);
                    setListening(!listening);
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              >
                {listening ? "关闭麦克风" : "开启麦克风"}
              </Button>
            </div>
          </section>
        )}
        {activity && (
          <section className="space-y-4 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">Agent 运行状态</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">
                {running ? activityLabels[activity.state] : labels[phase]}
              </span>
            </div>
            {!running && (
              <p className="text-xs text-muted-foreground">以下为最后收到的运行信息。</p>
            )}
            <div className="space-y-1 text-sm">
              <p>第 {activity.round} 轮</p>
              {running && !["ended", "failed"].includes(activity.state) && (
                <p className="text-muted-foreground">
                  当前状态持续 {Math.max(0, (now - activity.at) / 1000).toFixed(0)} 秒
                  {activity.until !== undefined &&
                    ` · 距继续 ${Math.max(0, Math.ceil((activity.until - now) / 1000))} 秒`}
                </p>
              )}
              {activity.detail && <p className="break-words">{activity.detail}</p>}
              <p className="break-all text-xs text-muted-foreground">模型：{activity.model}</p>
              {modelUsage && <p>最近请求耗时：{(modelUsage.durationMs / 1000).toFixed(1)} 秒</p>}
            </div>
            {tools.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <h3 className="text-sm font-medium">正在执行的工具</h3>
                {tools.map((tool) => (
                  <details key={tool.id} className="rounded-lg bg-muted p-2 text-xs">
                    <summary>
                      {tool.name} · {Math.max(0, (now - tool.at) / 1000).toFixed(0)} 秒
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words">{tool.detail}</pre>
                  </details>
                ))}
              </div>
            )}
            <div className="space-y-2 border-t pt-3 text-sm">
              <h3 className="font-medium">上下文与压缩</h3>
              {contextUsage ? (
                <>
                  <p>
                    上下文估算（最近检查）：{contextUsage.tokens.toLocaleString()} /{" "}
                    {contextUsage.windowTokens.toLocaleString()} token（
                    {((contextUsage.tokens / contextUsage.windowTokens) * 100).toFixed(1)}%）
                  </p>
                  <progress
                    aria-label="上下文占用"
                    value={contextUsage.tokens}
                    max={contextUsage.windowTokens}
                    className="h-2 w-full accent-primary"
                  />
                </>
              ) : (
                <p className="text-muted-foreground">尚未准备上下文</p>
              )}
              <p className="text-xs text-muted-foreground">70% 后台压缩 · 85% 等待压缩</p>
              <p>
                {compression ? compressionLabels[compression.state] : "尚未触发压缩"}
                {compression && ` · ${new Date(compression.at).toLocaleTimeString()}`}
              </p>
              {compression?.detail && (
                <p className="break-words text-xs text-destructive">{compression.detail}</p>
              )}
              {modelUsage && (
                <dl className="grid grid-cols-2 gap-1 text-xs">
                  <dt>最近请求实际输入</dt>
                  <dd>{modelUsage.inputTokens?.toLocaleString() ?? "未提供"}</dd>
                  <dt>最近请求实际输出</dt>
                  <dd>{modelUsage.outputTokens?.toLocaleString() ?? "未提供"}</dd>
                  <dt>输入缓存命中</dt>
                  <dd>{modelUsage.cacheReadTokens?.toLocaleString() ?? "未提供"}</dd>
                </dl>
              )}
            </div>
            <div className="space-y-1 border-t pt-3 text-sm">
              <h3 className="font-medium">表演状态</h3>
              <p>
                {running
                  ? performanceStatus
                    ? performanceLabels[performanceStatus.state]
                    : "空闲"
                  : "已停止"}
              </p>
              {performanceStatus && running && (
                <>
                  <p className="text-xs text-muted-foreground">
                    待播放台本：{performanceStatus.pending}
                    {!["idle", "failed", "interrupted"].includes(performanceStatus.state) &&
                      ` · 当前状态持续 ${Math.max(0, (now - performanceStatus.at) / 1000).toFixed(0)} 秒`}
                  </p>
                  {performanceStatus.detail && (
                    <p className="break-words">{performanceStatus.detail}</p>
                  )}
                </>
              )}
            </div>
          </section>
        )}
        {!running && (
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-medium">字幕测试</h2>
            <textarea
              aria-label="测试字幕内容"
              className="w-full rounded-lg border bg-background p-3"
              placeholder="输入用于调整 OBS 字幕样式的文字…"
              value={testSubtitle}
              onChange={(event) => setTestSubtitle(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                disabled={!connected || !testSubtitle.trim()}
                onClick={() => sendTestSubtitle(testSubtitle)}
              >
                发送测试字幕
              </Button>
              <Button variant="outline" disabled={!connected} onClick={() => sendTestSubtitle("")}>
                清空字幕
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              连接 agent 后即可测试，无需进入场景；实际语音播放会覆盖测试字幕。
            </p>
          </section>
        )}
        {!running && (
          <BrowserToolPanel
            available={phase === "waiting_entry" && browserConnected}
            test={browserTest}
            onExecute={(command) => {
              const id = crypto.randomUUID();
              session.current!.send({ type: "browser_test", id, command });
              setBrowserTest({ id, running: true, progress: [] });
            }}
          />
        )}
        {!running && (
          <>
            {draft && (
              <PreparationPanel
                draft={draft}
                editable={phase === "waiting_entry"}
                onChange={setDraft}
              />
            )}
            <div className="space-y-2">
              <Button onClick={enter}>进入</Button>
              {entryError && (
                <p role="alert" className="whitespace-pre-line text-sm text-destructive">
                  {entryError}
                </p>
              )}
            </div>
          </>
        )}

        {!running && records.length > 0 && (
          <section className="max-h-80 space-y-3 overflow-auto rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-medium">语音记录</h2>
            {records.map((record) => (
              <div key={record.url}>
                <p className="mb-2 text-sm">{record.text}</p>
                {/* biome-ignore lint/a11y/useMediaCaption: 相邻文本提供完整台词 */}
                <audio controls src={record.url} className="w-full" />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
