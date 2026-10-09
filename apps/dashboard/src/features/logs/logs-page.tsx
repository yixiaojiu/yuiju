"use client";

import { Pause, Play, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/api/logs";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type LogFileSelection, LogFileTree } from "@/features/logs/log-file-tree";
import { formatTime } from "@/lib/date";

/** 文件切换时通过 key 重建读取会话；游标与内容只属于当前选中的文件。 */
function LogContent({
  app,
  file,
  timezone,
  onReload,
}: {
  app: string;
  file: string;
  timezone: string;
  onReload: () => void;
}) {
  const [following, setFollowing] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string>();
  const offset = useRef<number | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const params = new URLSearchParams({ app, file });
        if (offset.current !== undefined) {
          params.set("offset", String(offset.current));
        }
        const response = await fetch(`/api/logs?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error);
        }
        offset.current = result.offset;
        setError(undefined);
        setEntries((previous) => [...previous, ...result.entries].slice(-1000));
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (following && !controller.signal.aborted) {
          timer = setTimeout(load, 2000);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [app, file, following]);
  const text = entries
    .map(
      (entry) =>
        `[${formatTime(entry.timestamp, timezone, true)}] [${entry.level}] ${entry.message}${entry.details ? `\n${entry.details}` : ""}`,
    )
    .join("\n");
  return (
    <section className="min-w-0 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all text-sm">{file}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFollowing(!following)}>
            {following ? <Pause /> : <Play />}
            {following ? "暂停" : "跟随"}
          </Button>
          <Button variant="outline" size="icon" aria-label="重新加载" onClick={onReload}>
            <RotateCw />
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <MonacoEditorPanel value={text} language="log" follow={following} />
    </section>
  );
}

export function LogsPage({ timezone }: { timezone: string }) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<LogFileSelection | null>(null);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">日志</h1>
      <div className="grid items-start gap-4 min-[1020px]:grid-cols-[280px_minmax(0,1fr)]">
        <LogFileTree selected={selected} onSelect={setSelected} />
        {selected ? (
          <LogContent
            key={`${selected.app}/${selected.file}/${revision}`}
            onReload={() => setRevision(revision + 1)}
            app={selected.app}
            file={selected.file}
            timezone={timezone}
          />
        ) : (
          <Card className="py-20 text-center text-sm text-muted-foreground">选择日志文件</Card>
        )}
      </div>
    </div>
  );
}
