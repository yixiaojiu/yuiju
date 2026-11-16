import type { VRM } from "@pixiv/three-vrm";
import { Vector3 } from "three";
import type { AvatarAnimator } from "./animator";
import { headingTowards } from "./player";

/** 她所有动作的播放速度倍率。原速的动作对她的人设来说偏快，放慢一些更从容、更淑女。 */
export const BARISTA_MOTION_SPEED = 0.8;
/** 她在吧台内走路的速度，单位米每秒。走路动作原速时对应 1.1 米每秒，跟着动作倍率放慢，脚才不会打滑。 */
const WALK_SPEED = 1.1 * BARISTA_MOTION_SPEED;
/** 转身的速度，单位弧度每秒。 */
const TURN_SPEED = 7;
/** 离目标不到这个距离就算走到了，单位米。 */
const ARRIVE_DISTANCE = 0.02;

/**
 * 她要做的一步：走到某个站位并面对它的朝向点，播放一个一次性动作，或者执行一段代码
 * （比如把杯子放到台面上后让杯子出现）。
 * 站位名对应场景文件里的 Anchor_spot_<名字> 锚点；"home" 是她平时待着的位置。
 */
export type BaristaStep =
  | { type: "walk"; spot: string }
  | { type: "play"; clip: string }
  | { type: "run"; action: () => void };

/**
 * 她在吧台内的行为编排：把一串步骤按顺序执行，走路时播放走路动作、到了转身面对目标，
 * 动作播完再进行下一步。步骤可以随时追加，排在已有步骤后面。
 */
export class BaristaDirector {
  private readonly vrm: VRM;
  private readonly animator: AvatarAnimator;
  private readonly anchors: Record<string, Vector3>;
  private readonly steps: BaristaStep[] = [];
  private running = false;
  /** 她现在的身体朝向（不含 VRM 0.x 的 π 修正）和要转到的朝向。 */
  private heading: number;
  private targetHeading: number;
  /** 正在走向的位置，走到时调用 arrive。 */
  private walk: { target: Vector3; arrive: () => void } | null = null;

  constructor(vrm: VRM, animator: AvatarAnimator, anchors: Record<string, Vector3>) {
    this.vrm = vrm;
    this.animator = animator;
    this.anchors = anchors;
    this.heading = vrm.scene.rotation.y - Math.PI;
    this.targetHeading = this.heading;
  }

  /** 她手上没有事：没有排队的步骤，也没在走路或做一次性动作。 */
  get idle() {
    return !this.running && !this.animator.busy;
  }

  /** 追加一串步骤，排在已有步骤之后执行。 */
  enqueue(steps: BaristaStep[]) {
    this.steps.push(...steps);
    this.run();
  }

  /** 每帧调用：走向目标、转向目标朝向，并切换走路和待机的基础动作。 */
  update(deltaSeconds: number) {
    const scene = this.vrm.scene;
    if (this.walk) {
      const offset = this.walk.target.clone().sub(scene.position);
      offset.y = 0;
      const distance = offset.length();
      if (distance <= ARRIVE_DISTANCE) {
        scene.position.copy(this.walk.target);
        const arrive = this.walk.arrive;
        this.walk = null;
        this.animator.setBase("idle");
        arrive();
      } else {
        scene.position.addScaledVector(
          offset.normalize(),
          Math.min(WALK_SPEED * deltaSeconds, distance),
        );
        this.targetHeading = headingTowards(offset);
      }
    }
    // 沿较短的方向转身。
    const turn = Math.atan2(
      Math.sin(this.targetHeading - this.heading),
      Math.cos(this.targetHeading - this.heading),
    );
    this.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_SPEED * deltaSeconds);
    scene.rotation.y = Math.PI + this.heading;
  }

  private async run() {
    if (this.running) {
      return;
    }
    this.running = true;
    while (this.steps.length > 0) {
      const step = this.steps.shift()!;
      if (step.type === "walk") {
        await this.walkTo(step.spot);
      } else if (step.type === "play") {
        await this.animator.playOnce(step.clip);
      } else {
        step.action();
      }
    }
    this.running = false;
  }

  /** 走到站位，到了以后转身面对它的朝向点。已经在站位上时只转身。 */
  private walkTo(spot: string) {
    const position =
      spot === "home" ? this.anchors.Anchor_character : this.anchors[`Anchor_spot_${spot}`];
    const face =
      spot === "home" ? this.anchors.Anchor_camera : this.anchors[`Anchor_spot_${spot}_face`];
    const target = new Vector3(position.x, 0, position.z);
    return new Promise<void>((resolve) => {
      this.animator.setBase("walk");
      this.walk = {
        target,
        arrive: () => {
          this.targetHeading = headingTowards(new Vector3(face.x - target.x, 0, face.z - target.z));
          resolve();
        },
      };
    });
  }
}
