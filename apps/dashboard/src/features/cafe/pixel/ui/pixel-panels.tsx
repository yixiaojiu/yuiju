import { useEffect, useRef, useState } from "react";
import type { CafeState } from "../../session/state";

/**
 * 像素风界面的样式：直角、粗深色外框加一道内框，参考像素游戏的快捷栏。
 * dark 用于常驻在画面上的条和按钮，paper 用于弹出的面板。
 */
export const pixelStyle = {
  dark: "border-[3px] border-[#1d1418] bg-[#3a2832] text-[#f6e7cc] shadow-[inset_0_0_0_2px_#7b5868]",
  paper:
    "border-[3px] border-[#2a1d18] bg-[#f3e3c3] text-[#3a2a22] shadow-[inset_0_0_0_3px_#fff4dc]",
  key: "inline-flex h-5 min-w-5 items-center justify-center border-2 border-[#1d1418] bg-[#f6e7cc] px-1 text-[11px] leading-none font-bold text-[#3a2832]",
  button: "hover:bg-[#4c3542] disabled:opacity-40 disabled:hover:bg-[#3a2832]",
};

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
    <PixelModal title="本日のメニュー" onClose={onClose}>
      <p className="mb-3 text-xs text-[#7a6352]">本次还可以点 {ordersLeft} 杯</p>
      <div className="flex flex-col gap-2">
        {menu.map((drink) => (
          <button
            key={drink.id}
            type="button"
            disabled={ordersLeft === 0}
            onClick={() => onOrder(drink.id)}
            className="flex items-center justify-between gap-4 border-2 border-[#2a1d18] bg-[#fff8e8] px-3 py-2 text-left hover:bg-[#ffe9bf] disabled:opacity-40"
          >
            <span>
              <span className="block font-bold">{drink.id}</span>
              <span className="block text-xs text-[#7a6352]">{drink.description}</span>
            </span>
            <span className="shrink-0 text-sm font-bold text-[#8a4b35]">¥{drink.price}</span>
          </button>
        ))}
      </div>
    </PixelModal>
  );
}

/** 留言板：钉在软木板上的便签，写一张新便签。 */
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
    <PixelModal title="留言板" onClose={onClose}>
      <div className="mb-4 grid max-h-72 grid-cols-2 gap-3 overflow-y-auto border-[3px] border-[#6b4a33] bg-[#c49a63] p-3">
        {notes.map((note, index) => (
          <div
            key={note.id}
            className={`${tints[index % tints.length]} border-2 border-[#2a1d18] p-2 ${index % 2 ? "rotate-1" : "-rotate-1"}`}
          >
            <p className="text-sm whitespace-pre-wrap">{note.text}</p>
            <p className="mt-2 text-right text-xs text-[#7a6352]">—— {note.author}</p>
          </div>
        ))}
      </div>
      <textarea
        value={text}
        maxLength={140}
        onChange={(event) => setText(event.target.value)}
        placeholder="给她留一张便签…"
        className="h-20 w-full resize-none border-2 border-[#2a1d18] bg-[#fff8e8] p-2 text-sm focus:outline-none"
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          onPost(text.trim());
          setText("");
        }}
        className={`mt-2 w-full py-2 text-sm font-bold ${pixelStyle.dark} ${pixelStyle.button}`}
      >
        钉到软木板上
      </button>
    </PixelModal>
  );
}

/** 像素风的弹出面板：点遮罩或按 Esc 关闭，打开时把焦点移进面板、关闭后还回去。 */
export function PixelModal({
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
      className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/40 outline-none"
    >
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className={`relative w-[min(460px,92vw)] p-5 ${pixelStyle.paper}`}>
        <div className="mb-4 flex items-center justify-between border-b-2 border-dashed border-[#c9ab82] pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[#7a6352] hover:text-[#3a2a22]"
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
