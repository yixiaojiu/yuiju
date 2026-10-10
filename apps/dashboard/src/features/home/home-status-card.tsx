import type { CharacterStatus } from "@/app/api/[[...route]]/routes/characters";
import { Card } from "@/components/ui/card";
import { formatTime } from "@/lib/date";

export function HomeStatusCard({
  data,
  now,
  todayActions,
}: {
  data: CharacterStatus;
  now: number;
  todayActions: string[];
}) {
  const { world, emotion } = data;
  const activity = world?.activity;
  const remaining =
    activity?.endsAt == null ? null : Math.max(0, Math.ceil((activity.endsAt - now) / 60000));
  const position = world?.position;
  const fields = [
    [
      "当前活动",
      activity
        ? `${activity.actionId}${remaining === null ? "" : remaining === 0 ? " · 等待结算" : ` · ${remaining}分钟`}`
        : "—",
    ],
    [
      "当前位置",
      position?.type === "at_place"
        ? position.place.name
        : position?.type === "moving"
          ? `${position.from.name} → ${position.to.name}`
          : "—",
    ],
    ["体力", world ? `${world.stamina} / 100` : "—"],
    ["饱腹度", world ? `${world.satiety} / 100` : "—"],
    ["金钱", world?.money ?? "—"],
    ["手机电量", world ? `${world.phoneBattery}%` : "—"],
  ];
  return (
    <Card className="gap-3.5 rounded-2xl p-3.5">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-bold">角色状态</h2>
        <span className="text-xs text-muted-foreground">{data.name}</span>
      </header>
      <div className="grid grid-cols-2 gap-2.5">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-secondary/50 p-2.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      {emotion && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["愉悦度", emotion.pleasure],
            ["激活度", emotion.activation],
            ["掌控感", emotion.control],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-secondary/50 p-2.5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1.5 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      <section className="space-y-2 rounded-xl border bg-secondary/40 p-3">
        <h3 className="text-xs text-muted-foreground">今日活动</h3>
        <div className="flex flex-wrap gap-1.5">
          {todayActions.length ? (
            todayActions.map((action) => (
              <span key={action} className="rounded-full border bg-card px-2 py-1 text-xs">
                {action}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">暂无</span>
          )}
        </div>
      </section>
      <details className="rounded-xl border bg-secondary/40 p-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          背包{world ? ` · ${world.inventory.length}` : ""}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {world?.inventory.map((item) => (
            <span key={item.itemId} className="rounded-lg border bg-card px-2 py-1 text-xs">
              {item.name} × {item.quantity}
            </span>
          ))}
        </div>
      </details>
      {!data.publicDeployment && (
        <>
          <section className="space-y-3 rounded-xl border bg-secondary/40 p-3">
            <h3 className="text-xs text-muted-foreground">计划</h3>
            {data.plans?.length ? (
              data.plans.map((plan) => (
                <div key={plan.id} className="text-xs leading-6">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{plan.content}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {
                        {
                          pending: "待进行",
                          in_progress: "进行中",
                          completed: "已完成",
                          cancelled: "已取消",
                        }[plan.status]
                      }
                    </span>
                  </div>
                  {plan.plannedAt !== null && (
                    <time className="text-muted-foreground">
                      {formatTime(plan.plannedAt, true)}
                    </time>
                  )}
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {plan.background}
                    {plan.progress && `\n${plan.progress}`}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">暂无</p>
            )}
          </section>
          <section className="space-y-2 rounded-xl border bg-secondary/40 p-3">
            <h3 className="text-xs text-muted-foreground">当前感受</h3>
            {data.feelings?.length ? (
              data.feelings.map((feeling, index) => (
                <p
                  key={`${feeling.occurredAt}-${index}`}
                  className="whitespace-pre-wrap text-xs leading-6"
                >
                  {feeling.content}
                </p>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">暂无</p>
            )}
          </section>
        </>
      )}
    </Card>
  );
}
