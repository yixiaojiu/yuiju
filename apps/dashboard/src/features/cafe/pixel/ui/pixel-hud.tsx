import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  BUBBLE_LIFETIME_MS,
  type Bubble,
  type CafeSession,
  type CafeState,
} from "../../session/state";
import type { PixelCafeStage, PixelPrompt } from "../stage/pixel-cafe-stage";
import { DrinkMenu, MessageBoard, pixelStyle } from "./pixel-panels";

/** 最近一条还在显示期内的气泡；思考中的"…"由她头顶的像素符号表示，这里不显示。 */
function latestBubble(bubbles: Bubble[], now: number) {
  return bubbles
    .filter((bubble) => !bubble.thinking && now - bubble.createdAt < BUBBLE_LIFETIME_MS)
    .at(-1);
}

/**
 * 店内的像素风界面，叠在舞台上。
 * 站着时 F 坐下或看留言板；坐着时 Q 打开菜单、E 喝一口、R 请她收走、F 起身；Enter 聊天。
 */
export function PixelHud({
  session,
  stage,
  prompt,
  onLeave,
}: {
  session: CafeSession;
  stage: PixelCafeStage;
  prompt: PixelPrompt;
  onLeave: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [openPanel, setOpenPanel] = useState<"menu" | "board" | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  // 气泡到时间要消失，每半秒刷新一次当前时间。
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const self = state.customers.find((customer) => customer.id === state.selfId)!;
  const onDuty = state.shop.status !== "closed";
  // 杯子归座位：自己座位前台面上的那杯（不管是谁点的），以及有没有正在给这个座位做的饮品。
  const seatCup = state.cups.find((cup) => cup.seat === self.seat);
  const seatOrdered = state.orders.some((order) => order.seat === self.seat);
  const canOrder = onDuty && self.seat !== null && seatCup === undefined && !seatOrdered;
  const canSip = seatCup !== undefined && seatCup.remaining > 0;
  const canClear = seatCup !== undefined;

  // 打开面板或在输入框里打字时，WASD 不再走动。
  useEffect(() => {
    stage.setControlsEnabled(openPanel === null && !inputFocused);
  }, [stage, openPanel, inputFocused]);

  useEffect(() => {
    function handleFocusChange() {
      const element = document.activeElement as HTMLElement | null;
      setInputFocused(element?.tagName === "INPUT" || element?.tagName === "TEXTAREA");
    }
    document.addEventListener("focusin", handleFocusChange);
    document.addEventListener("focusout", handleFocusChange);
    return () => {
      document.removeEventListener("focusin", handleFocusChange);
      document.removeEventListener("focusout", handleFocusChange);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
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
  }, [self.seat, prompt, session, openPanel, canOrder, canSip, canClear]);

  const baristaBubble = latestBubble(state.barista.bubbles, now);
  return (
    <div className="pointer-events-none absolute inset-0 text-sm">
      {/* 头顶标签：舞台每帧把它们移到角色头顶。她只显示对话气泡，其他顾客显示名字和气泡。 */}
      <div ref={(element) => stage.setLabel("barista", element)} className="absolute top-0 left-0">
        {baristaBubble && <SpeechBubble text={baristaBubble.text} />}
      </div>
      {state.customers
        .filter((customer) => customer.id !== state.selfId)
        .map((customer) => {
          const bubble = latestBubble(customer.bubbles, now);
          return (
            <div
              key={customer.id}
              ref={(element) => stage.setLabel(customer.id, element)}
              className="absolute top-0 left-0 flex flex-col items-center gap-1"
            >
              {bubble && <SpeechBubble text={bubble.text} />}
              <span className="bg-[#1d1418]/80 px-1.5 text-xs text-[#f6e7cc]">
                {customer.avatar.name}
              </span>
            </div>
          );
        })}

      <div className="absolute top-3 left-1/2 -translate-x-1/2">
        <StatusBar state={state} />
      </div>
      <button
        type="button"
        onClick={onLeave}
        className={`pointer-events-auto absolute top-3 right-3 px-4 py-1.5 font-bold ${pixelStyle.dark} ${pixelStyle.button}`}
      >
        离店
      </button>

      {self.seat !== null && (
        <div className="pointer-events-auto absolute top-1/2 right-4 flex -translate-y-1/2 flex-col gap-2">
          <SeatButton keyLabel="Q" disabled={!canOrder} onClick={() => setOpenPanel("menu")}>
            菜单
          </SeatButton>
          {(seatOrdered || seatCup) && (
            <p className="-mt-1 px-1 text-xs text-[#f6e7cc] [text-shadow:0_1px_0_#1d1418]">
              {seatOrdered ? "正在为这里做饮品" : "台面上还有一杯"}
            </p>
          )}
          {canSip && (
            <SeatButton keyLabel="E" onClick={() => session.sip()}>
              喝一口
            </SeatButton>
          )}
          {canClear && (
            <SeatButton keyLabel="R" onClick={() => session.clearCup()}>
              请她收走
            </SeatButton>
          )}
          <SeatButton keyLabel="F" onClick={() => session.stand()}>
            起身
          </SeatButton>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
        {prompt && (
          <div className={`flex items-center gap-2 px-3 py-1.5 ${pixelStyle.dark}`}>
            <kbd className={pixelStyle.key}>F</kbd>
            {prompt.type === "seat" ? "坐下" : "看留言板"}
          </div>
        )}
        <ChatBox
          bubbles={self.bubbles}
          now={now}
          disabled={!onDuty}
          onSend={(text) => session.say(text)}
        />
      </div>
      <p className="absolute bottom-4 left-4 text-xs text-[#f6e7cc]/60">
        WASD 走动 · F 交互 · Enter 聊天
      </p>

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

/** 顶部的店铺状态：营业中、当前班次、店里的人数、她正在做的事、正在放的唱片。 */
function StatusBar({ state }: { state: CafeState }) {
  const activityLabels: Record<CafeState["barista"]["activity"], string | null> = {
    idle: null,
    taking_order: "正在接单",
    making: "正在制作饮品",
    serving: "正在上饮品",
  };
  const activity = activityLabels[state.barista.activity];
  return (
    <div className={`flex items-center gap-3 px-4 py-1.5 whitespace-nowrap ${pixelStyle.dark}`}>
      <span className="font-bold text-[#b6dd8f]">営業中</span>
      <span>{state.shop.shiftLabel}</span>
      <span>
        店内 {state.customers.length}/{state.shop.capacity}
      </span>
      {activity && <span className="text-[#ffd27a]">{activity}</span>}
      {state.music.record && <span className="text-[#e9b872]">♪ {state.music.record.title}</span>}
    </div>
  );
}

function SeatButton({
  keyLabel,
  disabled,
  onClick,
  children,
}: {
  keyLabel: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-40 items-center gap-3 px-3 py-2 text-left font-bold ${pixelStyle.dark} ${pixelStyle.button}`}
    >
      <kbd className={pixelStyle.key}>{keyLabel}</kbd>
      {children}
    </button>
  );
}

/** 头顶的对话气泡：白底深色边框，下方一个小方块尖角指向说话的人。 */
function SpeechBubble({ text }: { text: string }) {
  return (
    <div className="relative mb-2 max-w-56 border-2 border-[#1d1418] bg-[#fffaf0] px-2.5 py-1.5 text-sm leading-snug break-words text-[#3a2a22]">
      {text}
      <span className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-r-2 border-b-2 border-[#1d1418] bg-[#fffaf0]" />
    </div>
  );
}

/** 底部聊天框和自己最近的发言：自己的话不显示在头顶，显示在输入框上方，最多 3 条。 */
function ChatBox({
  bubbles,
  now,
  disabled,
  onSend,
}: {
  bubbles: Bubble[];
  now: number;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const visible = bubbles.filter((bubble) => now - bubble.createdAt < BUBBLE_LIFETIME_MS).slice(-3);

  // 不在输入框里时按 Enter 聚焦输入框。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key === "Enter" &&
        !document.querySelector('[role="dialog"]') &&
        !["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function send() {
    const message = text.trim();
    if (message) {
      onSend(message);
      setText("");
      // 发送后收起输入框，回到走动；想接着说就再按 Enter。
      inputRef.current?.blur();
    }
  }

  return (
    <div className="flex w-[min(560px,90vw)] flex-col gap-2">
      {visible.length > 0 && (
        <div className="flex flex-col items-end gap-1" role="log" aria-label="我的发言">
          {visible.map((bubble) => (
            <div
              key={bubble.id}
              className="max-w-80 border-2 border-[#1d1418] bg-[#fffaf0] px-2.5 py-1.5 break-words text-[#3a2a22]"
            >
              <span className="block text-xs text-[#7a6352]">我</span>
              {bubble.text}
            </div>
          ))}
        </div>
      )}
      <div className={`pointer-events-auto flex items-center gap-2 p-1.5 pl-3 ${pixelStyle.dark}`}>
        <input
          ref={inputRef}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              send();
            }
            if (event.key === "Escape") {
              inputRef.current?.blur();
            }
          }}
          placeholder={disabled ? "她现在不在店里" : "按 Enter 说点什么…"}
          className="flex-1 bg-transparent text-[#f6e7cc] placeholder:text-[#f6e7cc]/50 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled={disabled || !text.trim()}
          onClick={send}
          className="border-2 border-[#1d1418] bg-[#e9b872] px-4 py-1 font-bold text-[#3a2a22] hover:bg-[#f3c98a] disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
