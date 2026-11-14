import type { CalendarTask } from "@yuiju/shared/world/calendar";
import { calendarStatusLabels, calendarTime } from "./time";

export function CalendarTaskList({
  tasks,
  timezone,
  now,
  onSelect,
}: {
  tasks: CalendarTask[];
  timezone: string;
  now: number;
  onSelect: (task: CalendarTask) => void;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-3 font-bold">
        未结束任务 <span className="text-sm font-normal text-muted-foreground">{tasks.length}</span>
      </h2>
      {tasks.length === 0 && <p className="text-sm text-muted-foreground">暂无未结束任务</p>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            onClick={() => onSelect(task)}
            className="rounded-xl border p-3 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex justify-between gap-2">
              <strong>{task.title}</strong>
              <span className="text-xs text-muted-foreground">
                {calendarStatusLabels[task.status]}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-muted-foreground">{task.description}</p>
            <p
              className={`mt-2 text-xs ${task.dueAt !== null && task.dueAt < now ? "text-destructive" : "text-muted-foreground"}`}
            >
              {task.dueAt === null
                ? "未设置截止时间"
                : `截止 ${calendarTime(task.dueAt, timezone, true)}${task.dueAt < now ? " · 已逾期" : ""}`}
            </p>
            {task.progress && <p className="mt-1 text-xs">{task.progress}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
