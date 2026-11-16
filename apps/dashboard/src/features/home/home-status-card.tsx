import dayjs from "dayjs";
import type { CharacterStatus } from "@/app/api/[[...route]]/routes/characters";
import { formatTime } from "@/lib/date";

/** 0–100 的身体与情绪数值统一用细条展示。 */
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary/15">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function HomeStatusCard({ data, now }: { data: CharacterStatus; now: number }) {
  const { world, emotion } = data;
  const activity = world?.activity;
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {data.name}
            {world?.position.type === "at_place" && ` · ${world.position.place.name}`}
            {world?.position.type === "moving" &&
              ` · ${world.position.from.name} → ${world.position.to.name}`}
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold">
            {world === null ? "暂无状态" : activity ? activity.actionId : "空闲"}
          </h1>
          {activity && (
            <p className="mt-1 text-sm text-muted-foreground">
              {activity.pause
                ? "已暂停"
                : activity.endsAt === null
                  ? `${formatTime(activity.startedAt)} 开始 · 无固定结束`
                  : `${formatTime(activity.startedAt)} – ${formatTime(activity.endsAt)} · ${
                      activity.endsAt > now
                        ? `剩余 ${Math.ceil((activity.endsAt - now) / 60000)} 分钟`
                        : "等待结算"
                    }`}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{formatTime(now)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{dayjs(now).format("M月D日")}</p>
        </div>
      </div>
      {activity && !activity.pause && activity.endsAt !== null && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000"
            style={{
              width: `${Math.min(100, ((now - activity.startedAt) / (activity.endsAt - activity.startedAt)) * 100)}%`,
            }}
          />
        </div>
      )}
      {(world || emotion) && (
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-3 lg:grid-cols-6">
          {world && (
            <>
              <Meter label="体力" value={world.stamina} />
              <Meter label="饱腹度" value={world.satiety} />
              <Meter label="手机电量" value={world.phoneBattery} />
            </>
          )}
          {emotion && (
            <>
              <Meter label="愉悦度" value={emotion.pleasure} />
              <Meter label="激活度" value={emotion.activation} />
              <Meter label="掌控感" value={emotion.control} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
