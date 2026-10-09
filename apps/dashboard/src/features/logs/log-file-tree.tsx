"use client";

import { ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { useQuery } from "@/lib/use-query";

export type LogFileSelection = {
  app: "character-runtime" | "world-simulator";
  file: string;
};

/** 每个服务独立查询目录，展开状态不随日志轮转改变。 */
function LogFolder({
  app,
  label,
  selected,
  onSelect,
}: {
  app: LogFileSelection["app"];
  label: string;
  selected: LogFileSelection | null;
  onSelect: (file: LogFileSelection) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { data, error } = useQuery<{ files: string[] }>(`/api/logs/files?app=${app}`, 10000);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`logs-${app}`}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-secondary"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Folder className="size-4 shrink-0 text-primary" />
        {label}
      </button>
      <div id={`logs-${app}`} hidden={!expanded} className="ml-3 border-l border-border pl-2">
        {!data ? (
          <p
            role={error ? "alert" : "status"}
            className={`px-3 py-2 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error || "加载中…"}
          </p>
        ) : data.files.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">暂无日志</p>
        ) : (
          data.files.map((file) => (
            <button
              type="button"
              key={file}
              title={file}
              aria-pressed={selected?.app === app && selected.file === file}
              onClick={() => onSelect({ app, file })}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${selected?.app === app && selected.file === file ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"}`}
            >
              <FileText className="size-4 shrink-0" />
              <span className="truncate font-mono">{file}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function LogFileTree({
  selected,
  onSelect,
}: {
  selected: LogFileSelection | null;
  onSelect: (file: LogFileSelection) => void;
}) {
  return (
    <Card className="max-h-[calc(100dvh-180px)] gap-1 overflow-auto rounded-xl p-3">
      <nav aria-label="日志文件">
        <LogFolder
          app="character-runtime"
          label="角色服务"
          selected={selected}
          onSelect={onSelect}
        />
        <LogFolder app="world-simulator" label="世界服务" selected={selected} onSelect={onSelect} />
      </nav>
    </Card>
  );
}
