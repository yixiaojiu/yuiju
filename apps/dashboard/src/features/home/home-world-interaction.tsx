import { cn } from "@yuiju/shared/ui/utils";
import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { NotificationState, WorldInteraction } from "@/app/api/[[...route]]/routes/world";
import { formatTime } from "@/lib/date";

const notificationLabels: Record<NotificationState, string> = {
  waiting: "待投递",
  active: "投递中",
  delayed: "延迟重试",
  failed: "失败",
};
const eventLabels: Record<WorldEvent["type"], string> = {
  activity_started: "活动开始",
  activity_completed: "活动完成",
  activity_paused: "活动暂停",
  activity_resumed: "活动继续",
  weather_changed: "天气变化",
  calendar_attention: "日程关注",
  idle_reminder: "空闲提醒",
  body_signal: "身体需求",
  school_notice: "学校通知",
};

function EventContent({
  event,
  now,
}: {
  event: Pick<WorldEvent, "type" | "occurredAt" | "description">;
  now: number;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{eventLabels[event.type]}</span>
        <time
          className="text-muted-foreground"
          title={`距事件发生 ${Math.floor((now - event.occurredAt) / 60000)} 分钟`}
        >
          {formatTime(event.occurredAt, true)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
        {event.description}
      </p>
    </>
  );
}

/** 调试信息默认折叠；只展示未完成链路，已接收与已完成决策是两个独立阶段。 */
export function HomeWorldInteraction({ data, now }: { data: WorldInteraction; now: number }) {
  const [notificationState, setNotificationState] = useState<NotificationState>("waiting");
  const group = data.notifications.find((item) => item.state === notificationState)!;
  const receivedCount = data.received.pendingCount + data.received.roundCount;
  const activity = data.activity;
  const wait = data.activityWait;

  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="font-semibold">运行状态</span>
        <span className="ml-auto flex flex-wrap justify-end gap-x-3 text-xs text-muted-foreground tabular-nums">
          {data.notifications
            .filter((item) => item.total > 0)
            .map((item) => (
              <span key={item.state} className={cn(item.state === "failed" && "text-destructive")}>
                {notificationLabels[item.state]} {item.total}
              </span>
            ))}
          {receivedCount > 0 && <span>未处理事件 {receivedCount}</span>}
        </span>
      </summary>
      <div className="grid gap-6 border-t p-5 lg:grid-cols-3">
        <section className="min-w-0">
          <h3 className="text-xs font-medium text-muted-foreground">世界通知</h3>
          <div className="mt-3 flex rounded-lg bg-secondary p-0.5">
            {data.notifications.map((item) => (
              <button
                type="button"
                key={item.state}
                aria-pressed={notificationState === item.state}
                onClick={() => setNotificationState(item.state)}
                className={cn(
                  "flex-1 rounded-md px-1 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  notificationState === item.state
                    ? "bg-card font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {notificationLabels[item.state]} {item.total}
              </button>
            ))}
          </div>
          <ul className="mt-2 max-h-80 divide-y overflow-y-auto">
            {group.events.length === 0 ? (
              <li className="py-6 text-center text-xs text-muted-foreground">
                暂无{notificationLabels[group.state]}通知
              </li>
            ) : (
              group.events.map((event) => (
                <li key={event.eventId} className="py-2.5">
                  <EventContent event={event} now={now} />
                  {(event.failures > 0 || event.retryAt !== null) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        event.failures > 0 && `失败 ${event.failures} 次`,
                        event.retryAt !== null && `计划重试 ${formatTime(event.retryAt, true)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {event.lastError && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">
                      {event.lastError}
                    </p>
                  )}
                </li>
              ))
            )}
          </ul>
          {group.total > group.events.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              显示最早的 {group.events.length} 条
            </p>
          )}
        </section>

        <section className="min-w-0">
          <h3 className="text-xs font-medium text-muted-foreground">
            角色接收 · 待下一轮 {data.received.pendingCount} · 当前轮次 {data.received.roundCount}
          </h3>
          <ul className="mt-3 max-h-80 divide-y overflow-y-auto">
            {data.received.events.length === 0 ? (
              <li className="py-6 text-center text-xs text-muted-foreground">
                暂无未完成的世界事件
              </li>
            ) : (
              data.received.events.map((event) => (
                <li key={event.eventId} className="py-2.5">
                  <EventContent event={event} now={now} />
                  <p className="mt-1 text-xs text-primary">
                    {event.inRound ? "已纳入当前轮次" : "待下一轮处理"}
                  </p>
                </li>
              ))
            )}
          </ul>
          {receivedCount > data.received.events.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              显示最早的 {data.received.events.length} 条
            </p>
          )}
        </section>

        <section className="min-w-0">
          <h3 className="text-xs font-medium text-muted-foreground">活动等待</h3>
          <dl className="mt-3 divide-y text-xs">
            {[
              ["当前活动", activity === null ? "暂无活动" : activity.actionId],
              ["开始时间", activity === null ? "—" : formatTime(activity.startedAt, true)],
              [
                "预计结束",
                activity?.pause
                  ? "恢复后重新计时"
                  : activity?.endsAt == null
                    ? "无固定结束时间"
                    : formatTime(activity.endsAt, true),
              ],
              [
                "活动计时",
                activity?.pause
                  ? activity.pause.remainingMs === null
                    ? "已暂停"
                    : `已暂停 · 剩余 ${Math.ceil(activity.pause.remainingMs / 60000)} 分钟`
                  : activity?.endsAt == null
                    ? "—"
                    : activity.endsAt > now
                      ? `剩余 ${Math.ceil((activity.endsAt - now) / 60000)} 分钟`
                      : `超时 ${Math.floor((now - activity.endsAt) / 60000)} 分钟`,
              ],
              [
                "兜底状态",
                wait === null ? "无需检查" : wait.checkAt === null ? "已触发" : "等待检查",
              ],
              ["兜底检查时间", wait?.checkAt == null ? "—" : formatTime(wait.checkAt, true)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {wait !== null && wait.endsAt !== activity?.endsAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              角色仍在等待预计 {formatTime(wait.endsAt, true)} 结束的活动
            </p>
          )}
        </section>
      </div>
    </details>
  );
}
