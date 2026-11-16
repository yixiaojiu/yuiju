import { useEffect, useState } from "react";
import type { LoadingProgress } from "../scene/stage";

/** 加载时底部轮播的提示。 */
const TIPS = [
  "她只在接了班的时段出现在店里，班次可以在日历上看到。",
  "坐到吧台前的圆凳上，就可以点单了。",
  "每次进店最多可以点三杯。",
  "她不在的时候，也可以去软木板上给她留言。",
  "按 Enter 随时和她说话，不用坐下。",
];
const TIP_INTERVAL_MS = 4500;

/**
 * 进入页面时的加载画面：店名、按下载字节计算的进度条、当前步骤和轮播提示。
 * 加载完成后淡出，淡出结束时调用 onHidden，由页面卸载它。
 * 加载失败时显示错误原因和"重新加载"按钮。
 */
export function LoadingScreen({
  progress,
  done,
  error,
  onHidden,
}: {
  progress: LoadingProgress;
  done: boolean;
  error: string | null;
  onHidden: () => void;
}) {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setTipIndex((index) => (index + 1) % TIPS.length),
      TIP_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#3a2a1c_0%,#14100c_70%)] transition-opacity duration-700 ${done ? "pointer-events-none opacity-0" : "opacity-100"}`}
      onTransitionEnd={() => {
        if (done) {
          onHidden();
        }
      }}
    >
      <p className="mb-2 text-xs tracking-[0.6em] text-[#e9b872]/70">喫 茶</p>
      <h1 className="mb-12 text-4xl font-bold tracking-[0.3em] text-[#f3e9d6]">薄暮咖啡</h1>

      {error ? (
        <div className="flex flex-col items-center gap-4">
          <p className="max-w-md text-center text-sm text-[#f0b0a0]">店门没能打开：{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-[#e9b872] px-6 py-2 text-sm font-bold text-stone-800"
          >
            重新加载
          </button>
        </div>
      ) : (
        <div className="flex w-72 flex-col items-center gap-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#e9b872] transition-[width] duration-300"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div className="flex w-full justify-between text-xs text-white/60">
            <span>{progress.step}…</span>
            <span>{Math.round(progress.fraction * 100)}%</span>
          </div>
        </div>
      )}

      <p className="absolute bottom-10 max-w-md px-6 text-center text-xs text-white/40">
        {TIPS[tipIndex]}
      </p>
    </div>
  );
}
