import { useEffect, useState } from "react";

/** 操作说明在屏幕上停留的时间。 */
const HINT_DURATION_MS = 8000;

const CONTROLS = [
  { keys: ["W", "A", "S", "D"], label: "走动" },
  { keys: ["移动鼠标"], label: "转视角" },
  { keys: ["按住 Alt"], label: "显示鼠标" },
  { keys: ["Enter"], label: "聊天" },
  { keys: ["F"], label: "坐下 / 看留言板" },
];

/** 进店后显示几秒的操作说明，然后淡出。每次进店重新挂载，所以每次进店都会出现。 */
export function ControlsHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HINT_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`absolute top-20 left-1/2 flex -translate-x-1/2 gap-5 rounded-2xl bg-black/50 px-6 py-3 text-sm text-white backdrop-blur transition-opacity duration-1000 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {CONTROLS.map((control) => (
        <span key={control.label} className="flex items-center gap-1.5">
          {control.keys.map((key) => (
            <kbd
              key={key}
              className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-bold text-stone-800"
            >
              {key}
            </kbd>
          ))}
          <span className="text-white/80">{control.label}</span>
        </span>
      ))}
    </div>
  );
}
