"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadProfile, type PlayerProfile, type PlayerSettings, saveProfile } from "./profile";
import { downloadAvatar, findPreset } from "./scene/avatar";
import { CafeStage, type LoadingProgress, type Prompt } from "./scene/stage";
import { createMockSession } from "./session/mock";
import type { AvatarConfig, CafeSession } from "./session/state";
import { AvatarStudioScreen } from "./ui/avatar-studio-screen";
import { ChatBox } from "./ui/chat-box";
import { ControlsHint } from "./ui/controls-hint";
import { LoadingScreen } from "./ui/loading-screen";
import { DrinkMenu, InteractionPrompt, MessageBoard, SeatMenu, ShopStatus } from "./ui/panels";
import { SettingsPanel } from "./ui/settings-panel";

/** 转场遮罩淡入或淡出的时长。 */
const CURTAIN_MS = 450;

/**
 * 页面阶段：
 * - booting：加载捏人要用的形象模型；
 * - studio：捏人，咖啡店在后台加载；
 * - waiting：捏好了但咖啡店还没加载完，接着显示咖啡店的加载进度；
 * - cafe：店内。离店后回到捏人。
 */
type Phase = "booting" | "studio" | "waiting" | "cafe";

/**
 * 咖啡店页面：加载 → 捏人 → 店内。每次进店都经过捏人，再次来时预先填好上次的配置。
 * 店内状态和玩家操作都经过 CafeSession；现在用本地假实现，之后换成连接服务端的实现。
 */
export function CafePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<CafeStage | null>(null);
  const [phase, setPhase] = useState<Phase>("booting");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [session, setSession] = useState<CafeSession | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [avatarProgress, setAvatarProgress] = useState<LoadingProgress>({
    fraction: 0,
    step: "正在准备你的形象",
  });
  const [cafeProgress, setCafeProgress] = useState<LoadingProgress>({
    fraction: 0,
    step: "正在布置店面",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingVisible, setLoadingVisible] = useState(true);
  // 进店和离店时的黑色转场遮罩。
  const [curtain, setCurtain] = useState(false);
  // 店里是否满席，满席时捏人界面不能进店。
  const [shopFull, setShopFull] = useState(false);
  // 鼠标是否锁定在画布上（锁定时移动鼠标转视角，鼠标指针隐藏）。
  const [pointerLocked, setPointerLocked] = useState(false);

  // 读取档案，先下载捏人要用的形象模型；同时在后台加载咖啡店。
  // session 和舞台一起创建、一起释放。开发模式下 effect 会执行两次，每次都是一对新的实例。
  useEffect(() => {
    const savedProfile = loadProfile();
    setProfile(savedProfile);
    const created = createMockSession();
    const stage = new CafeStage(containerRef.current!, created, {
      onPrompt: setPrompt,
      onSelfReady: () => setCurtain(false),
      onPointerLockChange: setPointerLocked,
    });
    stageRef.current = stage;
    stage.applySettings(savedProfile.settings);
    let unmounted = false;

    function fail(error: unknown) {
      // 加载失败交给加载画面显示原因，由用户决定重新加载。
      if (!unmounted) {
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoadingVisible(true);
      }
    }
    async function loadAvatarModel() {
      try {
        await downloadAvatar(findPreset(savedProfile.avatar.presetId).url, (event) =>
          setAvatarProgress({
            fraction: Math.min(event.loaded / event.total, 1),
            step: "正在准备你的形象",
          }),
        );
      } catch (error) {
        fail(error);
        return;
      }
      if (!unmounted) {
        setPhase("studio");
      }
    }
    async function loadCafe() {
      try {
        await stage.load(setCafeProgress);
      } catch (error) {
        fail(error);
        return;
      }
      if (!unmounted) {
        setSession(created);
      }
    }
    loadAvatarModel();
    loadCafe();
    return () => {
      unmounted = true;
      stageRef.current = null;
      stage.dispose();
      created.dispose();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    function updateShopFull() {
      setShopFull(session!.getState().shop.status === "full");
    }
    updateShopFull();
    return session.subscribe(updateShopFull);
  }, [session]);

  // 捏好了而咖啡店也加载完了，就直接进店；这期间满席了就回到捏人界面。
  // 这时已经不在用户的点击里，不能请求全屏和锁定鼠标，进店后由"点击画面继续"补上。
  useEffect(() => {
    if (phase !== "waiting" || !session) {
      return;
    }
    if (session.getState().shop.status === "full") {
      setPhase("studio");
      return;
    }
    setCurtain(true);
    session.enter(profile!.avatar);
    setPhase("cafe");
  }, [phase, session, profile]);

  // 只有咖啡店在画面上时才渲染舞台。
  useEffect(() => {
    stageRef.current?.setActive(phase === "cafe");
  }, [phase]);

  function updateProfile(next: PlayerProfile) {
    setProfile(next);
    saveProfile(next);
  }

  /**
   * 捏好形象就进店：先拉上遮罩，遮罩完全变黑后进店；自己的模型就位后舞台会通知揭开遮罩。
   * 全屏和鼠标锁定都必须在用户的点击里发起，所以在点确认这一下就请求。
   */
  function confirmAvatar(avatar: AvatarConfig, thumbnail: string) {
    updateProfile({ ...profile!, avatar, thumbnail });
    if (session) {
      document.documentElement.requestFullscreen();
      stageRef.current!.lockPointer();
      setCurtain(true);
      setTimeout(() => {
        session.enter(avatar);
        setPhase("cafe");
      }, CURTAIN_MS);
    } else {
      setLoadingVisible(true);
      setPhase("waiting");
    }
  }

  function changeSettings(settings: PlayerSettings) {
    updateProfile({ ...profile!, settings });
    stageRef.current!.applySettings(settings);
  }

  // 界面层在鼠标需要显示或隐藏时调用；保持引用稳定，避免每次渲染都重复请求锁定。
  const lockPointer = useCallback(() => stageRef.current!.lockPointer(), []);
  const unlockPointer = useCallback(() => stageRef.current!.unlockPointer(), []);

  /** 离店：遮罩变黑后离店，回到捏人界面，再揭开遮罩。 */
  function leaveShop() {
    stageRef.current!.unlockPointer();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    setCurtain(true);
    setTimeout(() => {
      session!.leave();
      setPhase("studio");
      setCurtain(false);
    }, CURTAIN_MS);
  }

  const loading = phase === "booting" || phase === "waiting";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black select-none">
      <div ref={containerRef} className="absolute inset-0" />
      {phase === "studio" && profile && (
        <AvatarStudioScreen
          initial={profile.avatar}
          cafeProgress={session ? null : cafeProgress}
          shopFull={shopFull}
          onConfirm={confirmAvatar}
        />
      )}
      {phase === "cafe" && session && profile && (
        <CafeHud
          session={session}
          prompt={prompt}
          profile={profile}
          onLeave={leaveShop}
          onSettingsChange={changeSettings}
          pointerLocked={pointerLocked}
          onLockPointer={lockPointer}
          onUnlockPointer={unlockPointer}
        />
      )}
      <div
        className={`pointer-events-none absolute inset-0 z-20 bg-black transition-opacity ${curtain ? "opacity-100" : "opacity-0"}`}
        style={{ transitionDuration: `${CURTAIN_MS}ms` }}
      />
      {loadingVisible && (
        <LoadingScreen
          progress={phase === "booting" ? avatarProgress : cafeProgress}
          done={!loading && loadError === null}
          error={loadError}
          onHidden={() => setLoadingVisible(false)}
        />
      )}
    </div>
  );
}

/** 叠在 3D 舞台上的店内界面。进店和离店的转场中自己还不在店里，这时什么也不显示。 */
function CafeHud({
  session,
  prompt,
  profile,
  onLeave,
  onSettingsChange,
  pointerLocked,
  onLockPointer,
  onUnlockPointer,
}: {
  session: CafeSession;
  prompt: Prompt;
  profile: PlayerProfile;
  onLeave: () => void;
  onSettingsChange: (settings: PlayerSettings) => void;
  pointerLocked: boolean;
  onLockPointer: () => void;
  onUnlockPointer: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [openPanel, setOpenPanel] = useState<"menu" | "board" | "settings" | null>(null);
  const self = state.customers.find((customer) => customer.id === state.selfId);

  const baristaOnDuty = state.shop.status !== "closed";
  // 自己座位前台面上的那杯（不管是谁点的），以及有没有正在给这个座位做的饮品。站着时都没有。
  const seatCup = state.cups.find((cup) => cup.seat === self?.seat);
  const seatOrdered = state.orders.some((order) => order.seat === self?.seat);
  const canSip = seatCup !== undefined && seatCup.remaining > 0;
  // 台面上有杯子或者正在给这个座位做饮品时不能再点：喝完、请她收走，或者换个座位。
  const canOrder = baristaOnDuty && seatCup === undefined && !seatOrdered;
  const canClear = seatCup !== undefined;
  const [altHeld, setAltHeld] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  // 打开面板、在输入框里打字、按住 Alt 时显示鼠标，其他时候鼠标锁定在画布上用来转视角。
  const cursorFree = altHeld || openPanel !== null || inputFocused;
  const inside = self !== undefined;

  useEffect(() => {
    if (!inside) {
      return;
    }
    if (cursorFree) {
      onUnlockPointer();
    } else {
      onLockPointer();
    }
  }, [inside, cursorFree, onLockPointer, onUnlockPointer]);

  // 按住 Alt 显示鼠标，松开恢复转视角。切走窗口时视为松开。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Alt") {
        // 阻止浏览器把 Alt 当成菜单快捷键。
        event.preventDefault();
        setAltHeld(true);
      }
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Alt") {
        setAltHeld(false);
      }
    }
    function handleBlur() {
      setAltHeld(false);
    }
    function handleFocusChange() {
      const element = document.activeElement as HTMLElement | null;
      setInputFocused(element?.tagName === "INPUT" || element?.tagName === "TEXTAREA");
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("focusin", handleFocusChange);
    document.addEventListener("focusout", handleFocusChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("focusin", handleFocusChange);
      document.removeEventListener("focusout", handleFocusChange);
    };
  }, []);

  // 站着时 F 执行交互提示（坐下或看留言板）；坐着时 Q 打开菜单、E 喝一口、R 请她收走杯子、F 起身。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        !self ||
        event.repeat ||
        event.isComposing ||
        openPanel !== null ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (self.seat === null) {
        if (event.code === "KeyF" && prompt?.type === "seat") {
          session.sit(prompt.seat);
        }
        if (event.code === "KeyF" && prompt?.type === "board") {
          setOpenPanel("board");
        }
        return;
      }
      if (event.code === "KeyQ" && canOrder) {
        setOpenPanel("menu");
      }
      if (event.code === "KeyE" && canSip) {
        session.sip();
      }
      if (event.code === "KeyR" && canClear) {
        session.clearCup();
      }
      if (event.code === "KeyF") {
        session.stand();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [self, prompt, session, openPanel, canOrder, canSip, canClear]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {self && (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <ShopStatus state={state} />
          </div>
          {profile.settings.showControlsHint && <ControlsHint key={self.id} />}
          <div className="pointer-events-auto absolute top-4 right-4 flex gap-2">
            <button
              type="button"
              onClick={() => setOpenPanel("settings")}
              className="rounded-full bg-black/45 px-4 py-2 text-sm text-white backdrop-blur hover:bg-black/60"
            >
              设置
            </button>
            <button
              type="button"
              onClick={onLeave}
              className="rounded-full bg-black/45 px-4 py-2 text-sm text-white backdrop-blur hover:bg-black/60"
            >
              离店
            </button>
          </div>
          {self.seat !== null && (
            <div className="absolute top-1/2 right-8 -translate-y-1/2">
              <SeatMenu
                canOrder={canOrder}
                orderHint={seatOrdered ? "正在为这里做饮品" : seatCup ? "台面上还有一杯" : null}
                canSip={canSip}
                canClear={canClear}
                onMenu={() => setOpenPanel("menu")}
                onSip={() => session.sip()}
                onClear={() => session.clearCup()}
                onStand={() => session.stand()}
              />
            </div>
          )}
          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
            <InteractionPrompt prompt={prompt} />
            <ChatBox
              bubbles={self.bubbles}
              disabled={!baristaOnDuty}
              onSend={(text) => session.say(text)}
            />
          </div>
          {profile.settings.showControlsHint && (
            <p className="absolute bottom-7 left-6 text-xs text-white/50">
              WASD 走动 · 移动鼠标转视角 · 按住 Alt 显示鼠标 · Enter 聊天
            </p>
          )}
          {!pointerLocked && !cursorFree && (
            <button
              type="button"
              onClick={() => {
                onLockPointer();
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen();
                }
              }}
              className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-black/35"
            >
              <span className="rounded-full bg-black/60 px-6 py-3 text-base text-white backdrop-blur">
                点击画面继续
              </span>
            </button>
          )}
        </>
      )}

      {openPanel === "menu" && (
        <DrinkMenu
          menu={state.menu}
          ordersLeft={state.ordersLeft}
          onOrder={(drinkId) => {
            session.order(drinkId);
            setOpenPanel(null);
          }}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "settings" && (
        <SettingsPanel
          settings={profile.settings}
          onChange={onSettingsChange}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "board" && (
        <MessageBoard
          notes={state.notes}
          onPost={(text) => session.postNote(text)}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}
