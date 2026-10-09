import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { useState } from "react";
import type { NotificationState, WorldInteraction } from "@/api/world";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  weather_changed: "天气变化",
  idle_reminder: "空闲提醒",
};

function EventContent({
  event,
  timezone,
  now,
}: {
  event: Pick<WorldEvent, "type" | "occurredAt" | "description">;
  timezone: string;
  now: number;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">{eventLabels[event.type]}</span>
        <time className="text-muted-foreground">
          {formatTime(event.occurredAt, timezone, true)}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-6">{event.description}</p>
      <p className="text-xs text-muted-foreground">
        距事件发生 {Math.floor((now - event.occurredAt) / 60000)} 分钟
      </p>
    </>
  );
}

/** 只展示未完成链路；已接收与已完成决策是两个独立阶段。 */
export function HomeWorldInteraction({
  data,
  timezone,
  now,
}: {
  data: WorldInteraction;
  timezone: string;
  now: number;
}) {
  const [notificationState, setNotificationState] = useState<NotificationState>("waiting");
  const group = data.notifications.find((item) => item.state === notificationState)!;
  const receivedCount = data.received.pendingCount + data.received.roundCount;
  const activity = data.activity;
  const wait = data.activityWait;

  return (
    <>
      <Card className="gap-3 rounded-2xl p-3.5">
        <h2 className="text-sm font-bold">世界通知</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {data.notifications.map((item) => (
            <Button
              key={item.state}
              variant={notificationState === item.state ? "secondary" : "outline"}
              aria-pressed={notificationState === item.state}
              className="h-auto flex-col gap-1 py-2.5"
              onClick={() => setNotificationState(item.state)}
            >
              <span className="text-xs text-muted-foreground">
                {notificationLabels[item.state]}
              </span>
              <span className="text-base font-semibold tabular-nums">{item.total}</span>
            </Button>
          ))}
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {group.events.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              暂无{notificationLabels[group.state]}通知
            </p>
          ) : (
            group.events.map((event) => (
              <article
                key={event.eventId}
                className="space-y-2 rounded-xl border bg-secondary/30 p-3"
              >
                <EventContent event={event} timezone={timezone} now={now} />
                {event.failures > 0 && (
                  <p className="text-xs text-muted-foreground">失败 {event.failures} 次</p>
                )}
                {event.lastError && (
                  <p className="whitespace-pre-wrap break-words text-xs text-destructive">
                    {event.lastError}
                  </p>
                )}
                {event.retryAt !== null && (
                  <p className="text-xs text-muted-foreground">
                    计划重试 {formatTime(event.retryAt, timezone, true)}
                  </p>
                )}
              </article>
            ))
          )}
        </div>
        {group.total > group.events.length && (
          <p className="text-xs text-muted-foreground">显示最早的 {group.events.length} 条</p>
        )}
      </Card>

      <Card className="gap-3 rounded-2xl p-3.5">
        <h2 className="text-sm font-bold">角色接收与处理</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border bg-secondary/50 p-2.5">
            <p className="text-xs text-muted-foreground">待下一轮处理</p>
            <p className="mt-1.5 text-sm font-semibold">{data.received.pendingCount}</p>
          </div>
          <div className="rounded-xl border bg-secondary/50 p-2.5">
            <p className="text-xs text-muted-foreground">当前未完成轮次</p>
            <p className="mt-1.5 text-sm font-semibold">{data.received.roundCount}</p>
          </div>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {data.received.events.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">暂无未完成的世界事件</p>
          ) : (
            data.received.events.map((event) => (
              <article
                key={event.eventId}
                className="space-y-2 rounded-xl border bg-secondary/30 p-3"
              >
                <span className="inline-block rounded-full border bg-card px-2 py-1 text-xs text-muted-foreground">
                  {event.inRound ? "已纳入当前轮次" : "待下一轮处理"}
                </span>
                <EventContent event={event} timezone={timezone} now={now} />
              </article>
            ))
          )}
        </div>
        {receivedCount > data.received.events.length && (
          <p className="text-xs text-muted-foreground">
            显示最早的 {data.received.events.length} 条
          </p>
        )}
      </Card>

      <Card className="gap-3 rounded-2xl p-3.5">
        <h2 className="text-sm font-bold">活动等待</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            ["当前活动", activity === null ? "暂无活动" : activity.actionId],
            ["开始时间", activity === null ? "—" : formatTime(activity.startedAt, timezone, true)],
            [
              "预计结束",
              activity?.endsAt == null
                ? "无固定结束时间"
                : formatTime(activity.endsAt, timezone, true),
            ],
            [
              "活动计时",
              activity?.endsAt == null
                ? "—"
                : activity.endsAt > now
                  ? `剩余 ${Math.ceil((activity.endsAt - now) / 60000)} 分钟`
                  : `超时 ${Math.floor((now - activity.endsAt) / 60000)} 分钟`,
            ],
            [
              "兜底状态",
              wait === null ? "无需检查" : wait.checkAt === null ? "已触发" : "等待检查",
            ],
            [
              "兜底检查时间",
              wait?.checkAt == null ? "—" : formatTime(wait.checkAt, timezone, true),
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-secondary/50 p-2.5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1.5 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
        {wait !== null && wait.endsAt !== activity?.endsAt && (
          <p className="text-xs text-muted-foreground">
            角色仍在等待预计 {formatTime(wait.endsAt, timezone, true)} 结束的活动
          </p>
        )}
      </Card>
    </>
  );
}
