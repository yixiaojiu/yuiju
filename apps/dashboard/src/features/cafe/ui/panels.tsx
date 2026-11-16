import { useEffect, useRef, useState } from "react";
import type { Prompt } from "../scene/stage";
import type { CafeState } from "../session/state";

/** 屏幕中央偏下的交互提示，例如"F 坐下"。 */
export function InteractionPrompt({ prompt }: { prompt: Prompt }) {
  if (!prompt) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/50 py-1.5 pr-4 pl-1.5 text-sm text-white backdrop-blur">
      <kbd className="flex h-6 w-6 items-center justify-center rounded-full bg-white font-bold text-stone-800">
        F
      </kbd>
      {prompt.type === "seat" ? "坐下" : "看留言板"}
    </div>
  );
}

/** 坐下后屏幕右侧的情境菜单：菜单、喝一口、请她收走、起身。参考《星布谷地》咖啡馆。 */
export function SeatMenu({
  canOrder,
  orderHint,
  canSip,
  canClear,
  onMenu,
  onSip,
  onClear,
  onStand,
}: {
  canOrder: boolean;
  /** 菜单不能点的原因，显示在菜单按钮下面；没有时为 null。 */
  orderHint: string | null;
  canSip: boolean;
  canClear: boolean;
  onMenu: () => void;
  onSip: () => void;
  onClear: () => void;
  onStand: () => void;
}) {
  const item =
    "flex w-44 items-center gap-3 rounded-lg bg-black/50 px-4 py-2.5 text-left text-base font-bold text-white backdrop-blur hover:bg-black/65 disabled:opacity-40";
  const key = "flex h-6 w-6 items-center justify-center rounded bg-white/90 text-xs text-stone-800";
  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      <button type="button" disabled={!canOrder} className={item} onClick={onMenu}>
        <kbd className={key}>Q</kbd>菜单
      </button>
      {orderHint && <p className="-mt-1 px-1 text-xs text-white/70">{orderHint}</p>}
      {canSip && (
        <button type="button" className={item} onClick={onSip}>
          <kbd className={key}>E</kbd>喝一口
        </button>
      )}
      {canClear && (
        <button type="button" className={item} onClick={onClear}>
          <kbd className={key}>R</kbd>请她收走
        </button>
      )}
      <button type="button" className={item} onClick={onStand}>
        <kbd className={key}>F</kbd>起身
      </button>
    </div>
  );
}

/** 点单面板：饮品列表和本次进店剩余的杯数，用完后不能再点。 */
export function DrinkMenu({
  menu,
  ordersLeft,
  onOrder,
  onClose,
}: {
  menu: CafeState["menu"];
  ordersLeft: number;
  onOrder: (drinkId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="本日のメニュー" onClose={onClose}>
      <p className="mb-3 text-xs text-stone-500">本次还可以点 {ordersLeft} 杯</p>
      <div className="flex flex-col gap-2">
        {menu.map((drink) => (
          <button
            key={drink.id}
            type="button"
            disabled={ordersLeft === 0}
            onClick={() => onOrder(drink.id)}
            className="flex items-center justify-between gap-4 rounded-lg bg-white/70 px-4 py-3 text-left hover:bg-white disabled:opacity-40"
          >
            <span>
              <span className="block font-bold text-stone-800">{drink.id}</span>
              <span className="block text-xs text-stone-500">{drink.description}</span>
            </span>
            <span className="shrink-0 text-sm text-stone-600">¥{drink.price}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** 留言板：浏览便签，写一张新便签。她不在店里时也可以留言。 */
export function MessageBoard({
  notes,
  onPost,
  onClose,
}: {
  notes: CafeState["notes"];
  onPost: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const tints = ["bg-[#fbf3dc]", "bg-[#e7efd9]", "bg-[#f6e0d6]"];
  return (
    <Modal title="留言板" onClose={onClose}>
      <div className="mb-4 grid max-h-72 grid-cols-2 gap-3 overflow-y-auto">
        {notes.map((note, index) => (
          <div key={note.id} className={`${tints[index % tints.length]} rounded p-3 shadow-sm`}>
            <p className="text-sm whitespace-pre-wrap text-stone-800">{note.text}</p>
            <p className="mt-2 text-right text-xs text-stone-500">—— {note.author}</p>
          </div>
        ))}
      </div>
      <textarea
        value={text}
        maxLength={140}
        onChange={(event) => setText(event.target.value)}
        placeholder="给她留一张便签…"
        className="h-20 w-full resize-none rounded-lg bg-white/80 p-3 text-sm text-stone-800 focus:outline-none"
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          onPost(text.trim());
          setText("");
        }}
        className="mt-2 w-full rounded-lg bg-[#e9b872] py-2 text-sm font-bold text-stone-800 disabled:opacity-40"
      >
        钉到软木板上
      </button>
    </Modal>
  );
}

/** 屏幕顶部的店铺状态：营业中或準備中、当前班次、店里的人数、她正在做的事。 */
export function ShopStatus({ state }: { state: CafeState }) {
  const activityLabels: Record<CafeState["barista"]["activity"], string | null> = {
    idle: null,
    taking_order: "正在接单",
    making: "正在制作饮品",
    serving: "正在上饮品",
  };
  const activity = activityLabels[state.barista.activity];
  return (
    <div className="flex items-center gap-3 rounded-full bg-black/45 px-5 py-2 text-sm text-white backdrop-blur">
      {state.shop.status === "closed" ? (
        <>
          <span className="font-bold text-[#e9b872]">準備中</span>
          <span className="text-white/70">下一班：{state.shop.nextShiftLabel}</span>
        </>
      ) : (
        <>
          <span className="font-bold text-[#a8d08d]">営業中</span>
          <span className="text-white/70">{state.shop.shiftLabel}</span>
          <span className="text-white/70">
            店内 {state.customers.length}/{state.shop.capacity}
          </span>
          {activity && <span className="text-white/70">· {activity}</span>}
          {state.music.record && (
            <span className="text-[#e9b872]/90">
              ♪ {state.music.record.title}
              {state.music.status === "paused" && "（已暂停）"}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panelRef.current!.focus();
    return () => previous.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/30 outline-none"
    >
      {/* 点击面板外的遮罩关闭面板。遮罩是一个铺满的按钮，面板叠在它上面。 */}
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-[min(480px,92vw)] rounded-2xl bg-[#f3e9d6] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">{title}</h2>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-stone-800">
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
