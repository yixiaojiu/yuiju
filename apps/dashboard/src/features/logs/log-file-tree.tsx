"use client";

import { cn } from "@yuiju/shared/ui/utils";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@/lib/use-query";

export type LogFileSelection = {
  app: "character-runtime" | "world-simulator";
  file: string;
};

/** 每个服务独立查询目录，展开状态不随日志轮转改变。 */
function LogFolder({
  app,
  label,
  characterId,
  selected,
  onSelect,
}: {
  app: LogFileSelection["app"];
  label: string;
  characterId: string;
  selected: LogFileSelection | null;
  onSelect: (file: LogFileSelection) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { data, error } = useQuery<{ files: string[] }>(
    `/api/logs/files?${new URLSearchParams({ app, ...(app === "character-runtime" && { characterId }) })}`,
    10000,
  );

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`logs-${app}`}
        onClick={() => setExpanded(!expanded)}
        className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <Folder aria-hidden="true" className="size-4 shrink-0 text-primary" />
        {label}
      </button>
      <div
        id={`logs-${app}`}
        hidden={!expanded}
        className="mt-0.5 ml-[15px] grid gap-0.5 border-l pl-2"
      >
        {!data ? (
          <p
            role={error ? "alert" : "status"}
            className={cn(
              "px-2 py-1.5 text-xs",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {error || "加载中…"}
          </p>
        ) : data.files.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无日志</p>
        ) : (
          data.files.map((file) => (
            <button
              type="button"
              key={file}
              title={file}
              aria-pressed={selected?.app === app && selected.file === file}
              onClick={() => onSelect({ app, file })}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selected?.app === app && selected.file === file
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate font-mono">{file}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function LogFileTree({
  characterId,
  selected,
  onSelect,
}: {
  characterId: string;
  selected: LogFileSelection | null;
  onSelect: (file: LogFileSelection) => void;
}) {
  return (
    <div className="max-h-[calc(100dvh-10rem)] overflow-auto rounded-2xl border bg-card p-2">
      <nav aria-label="日志文件" className="grid gap-1">
        <LogFolder
          characterId={characterId}
          app="character-runtime"
          label="角色服务"
          selected={selected}
          onSelect={onSelect}
        />
        <LogFolder
          characterId={characterId}
          app="world-simulator"
          label="世界服务"
          selected={selected}
          onSelect={onSelect}
        />
      </nav>
    </div>
  );
}
