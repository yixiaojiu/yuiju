import { cn } from "@yuiju/shared/ui/utils";

export function QueryState({ error, empty = false }: { error?: string; empty?: boolean }) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "rounded-2xl border border-dashed px-6 py-12 text-center text-sm",
        error ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {error || (empty ? "暂无记录" : "加载中…")}
    </div>
  );
}
