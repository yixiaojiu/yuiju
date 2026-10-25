/** 控制页与 Live2D 展示页都先加载 Core，随后才能导入 pixi-live2d-display。页面卸载时移除返回的脚本。 */
export async function loadCubismCore(signal: AbortSignal): Promise<HTMLScriptElement> {
  signal.throwIfAborted();
  const script = document.createElement("script");
  script.src = "/extensions/yuiju-interaction/live2dcubismcore.min.js";
  let abort!: () => void;
  try {
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Live2D Core 加载失败"));
      abort = () => {
        script.remove();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      document.head.appendChild(script);
    });
    return script;
  } catch (error) {
    script.remove();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
