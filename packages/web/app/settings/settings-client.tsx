"use client";

import { Clock3, Eye, Gauge, MessageCircle, Save, SlidersHorizontal } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  CHARACTER_MOVE_SPEED_MULTIPLIER_DEFAULT,
  CHARACTER_MOVE_SPEED_MULTIPLIER_MAX,
  CHARACTER_MOVE_SPEED_MULTIPLIER_MIN,
  CHARACTER_MOVE_SPEED_MULTIPLIER_STEP,
  CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY,
} from "@/components/game-scene/game/character/character-movement-speed";
import { useInterfacePreferences } from "@/lib/components/interface-preferences";
import {
  WEB_CHAT_OWNER_NAME_DEFAULT,
  WEB_CHAT_OWNER_NAME_STORAGE_KEY,
} from "@/lib/web-chat-preferences";

function SettingsRow({
  icon: Icon,
  label,
  detail,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  detail: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-h-18 flex-col gap-3 border-b border-[#e6eef7] py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#7e8ccb]" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-[#30363e]">{label}</p>
          <p className="mt-1 text-sm leading-5 text-[#8a95a2]">{detail}</p>
        </div>
      </div>
      <div className="shrink-0 sm:text-right">{value}</div>
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

export function SettingsClient() {
  const [ownerName, setOwnerName] = useState(WEB_CHAT_OWNER_NAME_DEFAULT);
  const [characterMoveSpeedMultiplier, setCharacterMoveSpeedMultiplier] = useState(
    CHARACTER_MOVE_SPEED_MULTIPLIER_DEFAULT,
  );
  const { showMessageTime, reduceMotion, setShowMessageTime, setReduceMotion } =
    useInterfacePreferences();

  useEffect(() => {
    const storedOwnerName = localStorage.getItem(WEB_CHAT_OWNER_NAME_STORAGE_KEY);
    if (storedOwnerName !== null) {
      setOwnerName(storedOwnerName);
    }

    const storedMultiplier = localStorage.getItem(CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY);
    if (storedMultiplier !== null) {
      setCharacterMoveSpeedMultiplier(Number(storedMultiplier));
    }
  }, []);

  const handleOwnerNameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextOwnerName = ownerName.trim();
    if (!nextOwnerName) {
      return;
    }

    setOwnerName(nextOwnerName);
    localStorage.setItem(WEB_CHAT_OWNER_NAME_STORAGE_KEY, nextOwnerName);
  };

  const handleCharacterMoveSpeedChange = (event: ChangeEvent<HTMLInputElement>) => {
    const multiplier = Number(event.currentTarget.value);
    setCharacterMoveSpeedMultiplier(multiplier);
    localStorage.setItem(CHARACTER_MOVE_SPEED_MULTIPLIER_STORAGE_KEY, String(multiplier));
  };

  return (
    <main className="min-h-[calc(100vh-78px)] bg-[#f7fbff] px-4 py-8 text-[#2b2f36] sm:px-6">
      <div className="mx-auto max-w-180">
        <header className="border-b border-[#d9e6f5] pb-5">
          <h1 className="text-2xl font-black tracking-tight">设置</h1>
          <p className="mt-2 text-sm text-[#74808e]">管理当前浏览器中的对话身份与界面偏好。</p>
        </header>

        <section className="mt-7" aria-labelledby="chat-settings-title">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-[#7e8ccb]" aria-hidden="true" />
            <h2 id="chat-settings-title" className="text-base font-bold">
              对话
            </h2>
          </div>
          <form className="mt-2 border-t border-[#d9e6f5] py-4" onSubmit={handleOwnerNameSubmit}>
            <label htmlFor="web-chat-owner-name" className="text-sm font-semibold text-[#30363e]">
              对话身份
            </label>
            <p className="mt-1 text-sm leading-5 text-[#8a95a2]">
              悠酱会用这个名字识别当前浏览器中的你。
            </p>
            <div className="mt-3 flex max-w-md gap-2">
              <input
                id="web-chat-owner-name"
                value={ownerName}
                required
                onChange={(event) => setOwnerName(event.currentTarget.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-[#d9e6f5] bg-white px-3 text-sm outline-none transition-colors focus:border-[#91c4ee] focus:ring-2 focus:ring-[#91c4ee]/20"
              />
              <button
                type="submit"
                disabled={!ownerName.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#7e8ccb] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#6e7fc4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                保存
              </button>
            </div>
          </form>
        </section>

        <section className="mt-7" aria-labelledby="interface-settings-title">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[#7e8ccb]" aria-hidden="true" />
            <h2 id="interface-settings-title" className="text-base font-bold">
              界面偏好
            </h2>
          </div>
          <div className="mt-2 border-t border-[#d9e6f5]">
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
                    className="h-1.5 w-36 cursor-pointer accent-[#7e8ccb] sm:w-44"
                  />
                  <output
                    htmlFor="character-move-speed"
                    className="inline-flex min-w-11 justify-center rounded-md bg-[#eef4fa] px-2 py-1 text-xs font-bold tabular-nums text-[#6c78b8]"
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
    </main>
  );
}
