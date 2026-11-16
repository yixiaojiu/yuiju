import type { VRM } from "@pixiv/three-vrm";
import { type AnimationAction, AnimationMixer, LoopOnce, LoopRepeat } from "three";
import { animationUrl, loadMixamoClip } from "./mixamo";

/** 动作切换时的淡入淡出时长，单位秒。 */
const FADE_SECONDS = 0.3;

/**
 * 一个角色的动作控制器。
 *
 * 角色始终有一个循环播放的"基础动作"（待机、走路、坐着），切换时平滑过渡；
 * 一次性动作（鞠躬、挥手、递杯子）叠在上面播放，播完自动淡回基础动作。
 * 每帧先调用 update 推进动作，再调用 vrm.update 把标准骨骼同步到模型骨骼并推进头发物理。
 */
export class AvatarAnimator {
  private readonly vrm: VRM;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private baseName: string | null = null;
  private oneShot: AnimationAction | null = null;
  /** 正在播放的一次性动作播完（或被下一个一次性动作打断）时调用，通知等待它的一方。 */
  private finishOneShot: (() => void) | null = null;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.mixer = new AnimationMixer(vrm.scene);
    this.mixer.addEventListener("finished", (event) => {
      if (event.action === this.oneShot) {
        this.oneShot = null;
        this.finishOneShot!();
        this.finishOneShot = null;
        event.action.fadeOut(FADE_SECONDS);
        this.actions.get(this.baseName!)!.reset().fadeIn(FADE_SECONDS).play();
      }
    });
  }

  /** 加载并套用一组动作，names 是动作名（对应动作文件名）。 */
  async load(names: string[]) {
    const clips = await Promise.all(
      names.map((name) => loadMixamoClip(animationUrl(name), this.vrm)),
    );
    names.forEach((name, index) => {
      this.actions.set(name, this.mixer.clipAction(clips[index]));
    });
  }

  /** 切换循环播放的基础动作。和当前相同时什么也不做。 */
  setBase(name: string) {
    if (name === this.baseName) {
      return;
    }
    const next = this.actions.get(name)!;
    next.setLoop(LoopRepeat, Infinity);
    const previous = this.baseName ? this.actions.get(this.baseName)! : null;
    this.baseName = name;
    // 一次性动作正在播时，只记下新的基础动作，等它播完再淡入。
    if (this.oneShot) {
      previous?.stop();
      return;
    }
    next.reset().play();
    if (previous) {
      previous.crossFadeTo(next, FADE_SECONDS, false);
    }
  }

  /** 播放一次性动作，播完自动淡回基础动作。返回的 Promise 在动作播完或被打断时完成。 */
  playOnce(name: string) {
    this.finishOneShot?.();
    const action = this.actions.get(name)!;
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    const from = this.oneShot ?? (this.baseName ? this.actions.get(this.baseName)! : null);
    this.oneShot = action;
    action.reset().play();
    if (from && from !== action) {
      from.crossFadeTo(action, FADE_SECONDS, false);
    }
    return new Promise<void>((resolve) => {
      this.finishOneShot = resolve;
    });
  }

  /** 是否正在播放一次性动作。正在鞠躬时不应该被说话的手势打断。 */
  get busy() {
    return this.oneShot !== null;
  }

  /** 基础动作的播放速度倍率，走路时按移动速度调整步频。 */
  setBaseSpeed(timeScale: number) {
    if (this.baseName) {
      this.actions.get(this.baseName)!.timeScale = timeScale;
    }
  }

  update(deltaSeconds: number) {
    this.mixer.update(deltaSeconds);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
  }
}
