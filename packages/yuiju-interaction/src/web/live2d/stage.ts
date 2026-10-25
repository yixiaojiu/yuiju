import { Application, Ticker } from "pixi.js";
import { type Cubism4InternalModel, Live2DFactory, Live2DModel } from "pixi-live2d-display/cubism4";
import type { Live2DFrame } from "../../protocol.ts";

/** 浏览器侧加载，必须在 Cubism Core 脚本就绪之后调用。 */
export async function createStage(
  container: HTMLDivElement,
  modelUrl: string,
  expressions: Record<string, string>,
  output: { mode: "control"; publishFrame(frame: Live2DFrame): void } | { mode: "mirror" },
) {
  Live2DModel.registerTicker(Ticker);
  const app = new Application({
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  const model = new Live2DModel<Cubism4InternalModel>({ autoInteract: false });
  try {
    await Live2DFactory.setupLive2DModel(model, modelUrl, { autoInteract: false });
    app.stage.addChild(model);
    // 表情先加载完，执行阶段不会因网络迟到而在打断后重新切换旧表情。
    if (Object.keys(expressions).length > 0) {
      const manager = model.internalModel.motionManager.expressionManager!;
      await Promise.all(
        manager.definitions.map((_, index) => Live2DFactory.loadExpression(manager, index)),
      );
    }
  } catch (error) {
    app.destroy(true, { children: true, texture: true, baseTexture: true });
    throw error;
  }
  container.appendChild(app.view);
  app.ticker.maxFPS = 60;
  model.anchor.set(0.5, 0.5);
  const width = model.width;
  const height = model.height;
  const resize = () => {
    app.renderer.resize(container.clientWidth, container.clientHeight);
    model.scale.set(
      Math.min(container.clientWidth / width, container.clientHeight / height) * 0.95,
    );
    model.position.set(container.clientWidth / 2, container.clientHeight / 2);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let mouth = 0;
  let mirroredFrame: Live2DFrame | undefined;
  let lastPublishedAt = 0;
  let gesture: { tag: "点头" | "摇头"; start: number } | null = null;
  const internal = model.internalModel;
  // 参数变化先于物理计算；头发等物理效果仍交给模型自身处理。
  internal.on("afterMotionUpdate", () => {
    if (output.mode === "mirror") {
      return;
    }
    const now = performance.now();
    const elapsed = gesture ? (now - gesture.start) / 1000 : 0;
    if (elapsed >= 1) {
      gesture = null;
    }
    const motion = gesture ? Math.sin(elapsed * Math.PI * 4) * Math.sin(elapsed * Math.PI) : 0;
    internal.coreModel.setParameterValueById(
      "ParamAngleX",
      Math.sin(now / 2800) * 1.5 + (gesture?.tag === "摇头" ? motion * 15 : 0),
    );
    internal.coreModel.setParameterValueById(
      "ParamAngleY",
      gesture?.tag === "点头" ? motion * 10 : 0,
    );
    internal.coreModel.setParameterValueById("ParamAngleZ", Math.sin(now / 3600) * 1.2);
  });
  // 口型最后写入，避免被表情或模型内置更新覆盖。
  internal.on("beforeModelUpdate", () => {
    const core = internal.coreModel;
    if (output.mode === "mirror") {
      if (mirroredFrame) {
        for (const [index, value] of mirroredFrame.parameters.entries()) {
          core.setParameterValueByIndex(index, value);
        }
        for (const [index, value] of mirroredFrame.parts.entries()) {
          core.setPartOpacityByIndex(index, value);
        }
      }
      return;
    }
    core.setParameterValueById("ParamMouthOpenY", mouth);
    // 参数与部件透明度一起同步；30 FPS 限制只影响向展示页传输，不影响本页渲染。
    const now = performance.now();
    if (now - lastPublishedAt >= 1000 / 30) {
      lastPublishedAt = now;
      output.publishFrame({
        parameters: Array.from({ length: core.getParameterCount() }, (_, index) =>
          core.getParameterValueByIndex(index),
        ),
        parts: Array.from({ length: core.getPartCount() }, (_, index) =>
          core.getPartOpacityByIndex(index),
        ),
      });
    }
  });

  /** 永久恢复默认表情；库的 resetExpression 本身只临时覆盖显示，保留旧表情记录。 */
  function resetExpression() {
    if (Object.keys(expressions).length > 0) {
      const manager = internal.motionManager.expressionManager!;
      manager.currentExpression = manager.defaultExpression;
      manager.resetExpression();
    }
  }

  return {
    applyFrame(frame: Live2DFrame) {
      mirroredFrame = frame;
    },
    setMouth(value: number) {
      mouth = value;
    },
    async perform(tags: string[]): Promise<number> {
      for (const tag of tags) {
        if (tag === "恢复") {
          gesture = null;
          resetExpression();
        } else if (tag === "点头" || tag === "摇头") {
          gesture = { tag, start: performance.now() };
        } else {
          await model.expression(expressions[tag]);
        }
      }
      return tags.some((tag) => tag === "点头" || tag === "摇头") ? 1000 : 0;
    },
    /** 台词结束只恢复表情，让点头、摇头继续完成。 */
    resetExpression,
    reset() {
      mouth = 0;
      gesture = null;
      resetExpression();
    },
    destroy() {
      observer.disconnect();
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    },
  };
}

export type Live2DStage = Awaited<ReturnType<typeof createStage>>;
