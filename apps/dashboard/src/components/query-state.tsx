export function QueryState({ error, empty = false }: { error?: string; empty?: boolean }) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-2xl border border-border/80 bg-card p-12 text-center text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
    >
      {error || (empty ? "暂无记录" : "加载中…")}
    </div>
  );
}
