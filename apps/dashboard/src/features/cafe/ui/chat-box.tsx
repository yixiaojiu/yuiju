import { useEffect, useRef, useState } from "react";
import { BUBBLE_LIFETIME_MS, type Bubble } from "../session/state";

/** 底部聊天输入框和本人的屏幕气泡。Enter 聚焦或发送，Esc 回到走动。 */
export function ChatBox({
  bubbles,
  disabled,
  onSend,
}: {
  bubbles: Bubble[];
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [now, setNow] = useState(Date.now);
  const visibleBubbles = bubbles
    .filter((bubble) => now - bubble.createdAt < BUBBLE_LIFETIME_MS)
    .slice(-3);

  useEffect(() => {
    const currentTime = Date.now();
    const timers = bubbles
      .filter((bubble) => currentTime - bubble.createdAt < BUBBLE_LIFETIME_MS)
      .slice(-3)
      .map((bubble) =>
        window.setTimeout(
          () => setNow(Date.now()),
          bubble.createdAt + BUBBLE_LIFETIME_MS - currentTime,
        ),
      );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [bubbles]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key === "Enter" &&
        target.tagName !== "BUTTON" &&
        !document.querySelector('[role="dialog"]') &&
        target.tagName !== "INPUT" &&
        target.tagName !== "TEXTAREA"
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
      // 发送后收起输入框，鼠标回到转视角；想接着说就再按 Enter。
      inputRef.current?.blur();
    }
  }

  return (
    <div className="flex w-[min(640px,90vw)] flex-col gap-3">
      {visibleBubbles.length > 0 && (
        <div className="flex flex-col items-end gap-1" role="log" aria-label="我的发言">
          {visibleBubbles.map((bubble) => (
            <div
              key={bubble.id}
              className="max-w-80 rounded-2xl rounded-br-sm bg-[#fbf6ec]/95 px-4 py-2 text-sm leading-relaxed break-words text-stone-800 shadow-md"
            >
              <span className="mb-0.5 block text-xs text-stone-500">我</span>
              {bubble.text}
            </div>
          ))}
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/45 p-1.5 pl-5 backdrop-blur">
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
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled={disabled || !text.trim()}
          onClick={send}
          className="rounded-full bg-[#e9b872] px-5 py-1.5 text-sm font-bold text-stone-800 disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
