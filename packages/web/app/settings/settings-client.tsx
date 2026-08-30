"use client";

import {
  Activity,
  BrainCircuit,
  Check,
  Clock3,
  Database,
  Eye,
  Gauge,
  MessageCircle,
  RefreshCw,
  Server,
  SlidersHorizontal,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useState, useTransition } from "react";
import {
  CHARACTER_MOVE_SPEED_MULTIPLIER_DEFAULT,
  CHARACTER_MOVE_SPEED_MULTIPLIER_MAX,
  CHARACTER_MOVE_SPEED_MULTIPLIER_MIN,
  CHARACTER_MOVE_SPEED_MULTIPLIER_STEP,
  CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY,
} from "@/components/game-scene/game/character/character-movement-speed";
import { useInterfacePreferences } from "@/lib/components/interface-preferences";
import type { ServiceStatus, SettingsSnapshot } from "./settings-data";

function formatDate(value: string | null): string {
  if (!value) {
    return "暂无归档";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusMark({ status }: { status: ServiceStatus }) {
  const online = status === "online";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${online ? "text-[#397c63]" : "text-[#ad5e69]"}`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? "bg-[#63b28d]" : "bg-[#d9848f]"}`} />
      {online ? "正常" : "不可用"}
    </span>
  );
}

function StatusBand({ snapshot }: { snapshot: SettingsSnapshot }) {
  const items = [
    {
      label: "运行环境",
      value: snapshot.environment === "development" ? "开发环境" : "生产环境",
      icon: Server,
      tone: "text-[#6c78b8]",
    },
    {
      label: "聊天模型",
      value: snapshot.chat.model,
      icon: MessageCircle,
      tone: "text-[#5a91b9]",
    },
    {
      label: "MongoDB",
      value: <StatusMark status={snapshot.mongo.status} />,
      icon: Database,
      tone: "text-[#a37582]",
    },
    {
      label: "Redis",
      value: <StatusMark status={snapshot.redis.status} />,
      icon: Wifi,
      tone: "text-[#4e9b86]",
    },
  ];

  return (
    <div className="grid overflow-hidden rounded-lg border border-[#d9e6f5] bg-white sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className={`flex min-h-22 items-center gap-3 px-5 py-4 ${index === 1 ? "border-t border-[#d9e6f5] sm:border-l sm:border-t-0" : ""} ${index === 2 ? "border-t border-[#d9e6f5] lg:border-l lg:border-t-0" : ""} ${index === 3 ? "border-t border-[#d9e6f5] sm:border-l lg:border-t-0" : ""}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${item.tone}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-wide text-[#8b96a4]">{item.label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-[#2b2f36]">{item.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  detail,
  value,
}: {
  icon: typeof Activity;
  label: string;
  detail?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-h-18 items-center gap-3 border-b border-[#e6eef7] py-4 last:border-b-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f4f8fc] text-[#7e8ccb]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#30363e]">{label}</p>
        {detail ? <p className="mt-1 text-xs leading-5 text-[#8a95a2]">{detail}</p> : null}
      </div>
      <div className="shrink-0 text-right text-sm text-[#5d6875]">{value}</div>
    </div>
  );
}

function PreferenceSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full p-1 transition-colors ${checked ? "bg-[#7e8ccb]" : "bg-[#cbd7e4]"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export function SettingsClient({ snapshot }: { snapshot: SettingsSnapshot }) {
  const router = useRouter();
  const [isRefreshing, startRefreshing] = useTransition();
  const [characterMoveSpeedMultiplier, setCharacterMoveSpeedMultiplier] = useState(
    CHARACTER_MOVE_SPEED_MULTIPLIER_DEFAULT,
  );
  const { showMessageTime, reduceMotion, setShowMessageTime, setReduceMotion } =
    useInterfacePreferences();

  useEffect(() => {
    const storedMultiplier = localStorage.getItem(CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY);
    if (storedMultiplier !== null) {
      setCharacterMoveSpeedMultiplier(Number(storedMultiplier));
    }
  }, []);

  const handleCharacterMoveSpeedChange = (event: ChangeEvent<HTMLInputElement>) => {
    const multiplier = Number(event.currentTarget.value);
    setCharacterMoveSpeedMultiplier(multiplier);
    localStorage.setItem(CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY, String(multiplier));
  };

  return (
    <main className="min-h-[calc(100vh-78px)] bg-[#f7fbff] px-4 py-8 text-[#2b2f36] sm:px-6">
      <div className="mx-auto max-w-240">
        <header className="flex flex-col items-start justify-between gap-4 border-b border-[#d9e6f5] pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-[#7e8ccb]">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              LOCAL CONSOLE
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">设置</h1>
            <p className="mt-2 text-sm text-[#74808e]">运行状态、记忆归档与当前浏览器偏好</p>
          </div>
          <button
            type="button"
            onClick={() => startRefreshing(() => router.refresh())}
            disabled={isRefreshing}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e6f5] bg-white px-3 text-xs font-semibold text-[#657285] transition-colors hover:border-[#91c4ee] hover:text-[#2b2f36] disabled:cursor-wait disabled:opacity-60"
            title="刷新运行状态"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            刷新状态
          </button>
        </header>

        <section className="mt-6" aria-labelledby="runtime-status-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="runtime-status-title"
              className="text-xs font-bold tracking-[0.12em] text-[#7e8ccb]"
            >
              运行状态
            </h2>
            <span className="text-xs text-[#9aa4af]">
              更新于 {formatDate(snapshot.generatedAt)}
            </span>
          </div>
          <StatusBand snapshot={snapshot} />
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="web-chat-settings-title">
            <div className="mb-2 flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-[#7e8ccb]" aria-hidden="true" />
              <h2 id="web-chat-settings-title" className="text-base font-bold">
                Web 对话
              </h2>
            </div>
            <div className="border-t border-[#d9e6f5]">
              <SettingsRow
                icon={Activity}
                label="Web 私聊"
                detail="当前网页对话入口"
                value={<StatusMark status={snapshot.message.status} />}
              />
              <SettingsRow
                icon={UserRound}
                label="对话身份"
                detail="网页消息使用的角色身份"
                value={snapshot.chat.identity}
              />
            </div>
          </section>

          <section aria-labelledby="memory-settings-title">
            <div className="mb-2 flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-[#7e8ccb]" aria-hidden="true" />
              <h2 id="memory-settings-title" className="text-base font-bold">
                记忆
              </h2>
            </div>
            <div className="border-t border-[#d9e6f5]">
              <SettingsRow
                icon={Database}
                label="对话归档"
                detail="MongoDB 中的 conversation Episode"
                value={snapshot.mongo.episodeCount ?? "不可用"}
              />
              <SettingsRow
                icon={Clock3}
                label="最近归档"
                detail="最近一次对话窗口归档时间"
                value={formatDate(snapshot.mongo.latestArchiveAt)}
              />
              <SettingsRow
                icon={UserRound}
                label="人物记忆"
                detail="people 目录中的长期记忆"
                value={snapshot.personMemory.count ?? "不可用"}
              />
              <SettingsRow
                icon={Gauge}
                label="互动热度"
                detail={`${snapshot.chat.identity} 的累计互动热度`}
                value={snapshot.personMemory.interactionHeat ?? "不可用"}
              />
            </div>
          </section>

          <section className="lg:col-span-2" aria-labelledby="interface-settings-title">
            <div className="mb-2 flex items-center gap-2">
              <Eye className="h-4 w-4 text-[#7e8ccb]" aria-hidden="true" />
              <h2 id="interface-settings-title" className="text-base font-bold">
                界面偏好
              </h2>
            </div>
            <div className="border-t border-[#d9e6f5]">
              <SettingsRow
                icon={Gauge}
                label="人物移速"
                detail="调整月汐海岸中人物的移动速度，下次打开游戏时生效"
                value={
                  <div className="flex items-center gap-3">
                    <input
                      id="character-move-speed"
                      type="range"
                      min={CHARACTER_MOVE_SPEED_MULTIPLIER_MIN}
                      max={CHARACTER_MOVE_SPEED_MULTIPLIER_MAX}
                      step={CHARACTER_MOVE_SPEED_MULTIPLIER_STEP}
                      value={characterMoveSpeedMultiplier}
                      aria-label="人物移速"
                      onChange={handleCharacterMoveSpeedChange}
                      className="h-1.5 w-28 cursor-pointer accent-[#7e8ccb] sm:w-44"
                    />
                    <output
                      htmlFor="character-move-speed"
                      className="inline-flex min-w-11 justify-center rounded-md bg-[#f4f8fc] px-2 py-1 text-xs font-bold tabular-nums text-[#6c78b8]"
                    >
                      {characterMoveSpeedMultiplier}×
                    </output>
                  </div>
                }
              />
              <SettingsRow
                icon={Clock3}
                label="消息时间"
                detail="在聊天消息下方显示发送时间"
                value={
                  <PreferenceSwitch
                    checked={showMessageTime}
                    label="显示聊天消息时间"
                    onChange={setShowMessageTime}
                  />
                }
              />
              <SettingsRow
                icon={SlidersHorizontal}
                label="减少动效"
                detail="降低页面过渡与循环动画"
                value={
                  <PreferenceSwitch
                    checked={reduceMotion}
                    label="减少页面动效"
                    onChange={setReduceMotion}
                  />
                }
              />
            </div>
          </section>
        </div>

        <footer className="mt-8 flex items-center gap-2 border-t border-[#d9e6f5] pt-4 text-xs text-[#97a1ad]">
          {snapshot.mongo.status === "online" && snapshot.redis.status === "online" ? (
            <Check className="h-3.5 w-3.5 text-[#63b28d]" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5 text-[#d9848f]" aria-hidden="true" />
          )}
          <span>配置与凭据保持只读，状态来自当前运行实例</span>
        </footer>
      </div>
    </main>
  );
}
