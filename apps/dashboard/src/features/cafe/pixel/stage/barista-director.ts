import { type PixelActionName, pixelActions } from "../../scene/pixel-actions";
import type { createPixelCharacter } from "../../scene/pixel-character";
import type { CafeState } from "../../session/state";
import { BARISTA_HOME, BARISTA_MACHINE, baristaSeatSpot, type Spot } from "./layout";

type Character = ReturnType<typeof createPixelCharacter>;

/** 她要做的一步：走到某个站位、播放一个一次性动作，或者执行一段代码（比如把杯子放上台面）。 */
type Step =
  | { type: "walk"; spot: Spot }
  | { type: "play"; action: PixelActionName }
  | { type: "run"; run: () => void };

/** 走路速度，单位每秒；转身速度，单位弧度每秒。 */
const WALK_SPEED = 1.1;
const TURN_SPEED = 9;
/** 回复出现后她说话的秒数。 */
const TALK_SECONDS = 1.8;
/** 空闲时每隔多久擦一会儿杯子、擦多久，单位秒。 */
const WIPE_EVERY = 14;
const WIPE_SECONDS = 4;

/**
 * 她在吧台内的行为编排：把店内状态的变化翻译成一串步骤（走位、动作），按顺序执行。
 * 没有步骤时按她当前的状态循环一个动作：说话、思考、在咖啡机前制作、擦杯子或待机。
 */
export class BaristaDirector {
  /** 她在地面上的位置和朝向（0 朝向镜头）。 */
  readonly position = { x: BARISTA_HOME.x, z: BARISTA_HOME.z };
  heading = BARISTA_HOME.heading;
  /** 正在端过去的杯子所在的座位：她推到顾客面前之前，台面上不显示这杯。 */
  readonly carrying = new Set<number>();
  /** 已经从店内状态里移除、但她还没走过去拿走的杯子：座位 → 剩余量。 */
  readonly lingering = new Map<number, number>();

  private readonly character: Character;
  private readonly steps: Step[] = [];
  private current: { step: Step; endsAt: number } | null = null;
  private targetHeading = BARISTA_HOME.heading;
  private looping: PixelActionName | null = null;
  private thinking = false;
  private making = false;
  private talkUntil = 0;
  private wipeUntil = 0;
  private nextWipe = WIPE_EVERY;

  constructor(character: Character) {
    this.character = character;
  }

  /** 店内状态变化时调用：对比前后两份状态，把需要她做的事排进步骤。 */
  onStateChange(previous: CafeState, next: CafeState, time: number) {
    const known = (list: { id: string }[], id: string) => list.some((item) => item.id === id);
    // 有人进店：挥手打招呼。
    if (next.customers.some((customer) => !known(previous.customers, customer.id))) {
      this.steps.push({ type: "play", action: "wave" });
    }
    // 接下一单：点头。
    if (next.orders.length > previous.orders.length) {
      this.steps.push({ type: "play", action: "nod" });
    }
    // 开始制作：走到咖啡机前，到了以后循环制作动作。
    if (previous.barista.activity !== "making" && next.barista.activity === "making") {
      this.steps.push({ type: "walk", spot: BARISTA_MACHINE });
    }
    this.making = next.barista.activity === "making";
    // 新出现的杯子：她走到那张圆凳前把杯子推过去，推完才在台面上显示。
    for (const cup of next.cups.filter((cup) => !known(previous.cups, cup.id))) {
      this.carrying.add(cup.seat);
      this.steps.push(
        { type: "walk", spot: baristaSeatSpot(cup.seat) },
        { type: "play", action: "serve" },
        { type: "run", run: () => this.carrying.delete(cup.seat) },
        { type: "walk", spot: BARISTA_HOME },
      );
    }
    // 被收走的杯子：先留在台面上，她走过去拿起时才消失。
    for (const cup of previous.cups.filter((cup) => !known(next.cups, cup.id))) {
      this.lingering.set(cup.seat, cup.remaining);
      this.steps.push(
        { type: "walk", spot: baristaSeatSpot(cup.seat) },
        { type: "run", run: () => this.lingering.delete(cup.seat) },
        { type: "play", action: "collect" },
        { type: "walk", spot: BARISTA_HOME },
      );
    }
    // 思考气泡显示期间她在思考；新的回复出现后说一会儿话。
    this.thinking = next.barista.bubbles.some((bubble) => bubble.thinking);
    if (
      next.barista.bubbles.some(
        (bubble) => !bubble.thinking && !known(previous.barista.bubbles, bubble.id),
      )
    ) {
      this.talkUntil = time + TALK_SECONDS;
    }
  }

  update(dt: number, time: number) {
    if (this.current && this.current.step.type === "walk") {
      this.walkToward(this.current.step.spot, dt);
    }
    if (this.current && this.current.step.type === "play" && time >= this.current.endsAt) {
      this.current = null;
    }
    while (!this.current && this.steps.length > 0) {
      this.start(this.steps.shift()!, time);
    }
    if (!this.current) {
      this.setLoop(this.restingAction(time));
    }
    // 朝向按转身速度转到目标朝向，走最近的方向。
    const turn = Math.atan2(
      Math.sin(this.targetHeading - this.heading),
      Math.cos(this.targetHeading - this.heading),
    );
    this.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_SPEED * dt);
  }

  private start(step: Step, time: number) {
    if (step.type === "run") {
      step.run();
      return;
    }
    this.current = {
      step,
      endsAt: time + (step.type === "play" ? pixelActions[step.action].duration : 0),
    };
    if (step.type === "walk") {
      this.setLoop("walk");
    } else {
      // 一次性动作播完会回到当前的循环动作，先切成待机，免得原地走路。
      this.setLoop("idle");
      this.character.play(step.action);
    }
  }

  private walkToward(spot: Spot, dt: number) {
    const dx = spot.x - this.position.x,
      dz = spot.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const stride = WALK_SPEED * dt;
    if (distance <= stride) {
      this.position.x = spot.x;
      this.position.z = spot.z;
      this.targetHeading = spot.heading;
      this.current = null;
      return;
    }
    this.position.x += (dx / distance) * stride;
    this.position.z += (dz / distance) * stride;
    this.targetHeading = Math.atan2(dx, dz);
  }

  /** 没有步骤时循环的动作，空闲在原位时每隔一阵子擦一会儿杯子。 */
  private restingAction(time: number): PixelActionName {
    if (time < this.talkUntil) {
      return "talk";
    }
    if (this.thinking) {
      return "think";
    }
    const atMachine =
      this.position.x === BARISTA_MACHINE.x && this.position.z === BARISTA_MACHINE.z;
    if (this.making && atMachine) {
      return "brew";
    }
    if (time >= this.nextWipe) {
      this.wipeUntil = time + WIPE_SECONDS;
      this.nextWipe = time + WIPE_SECONDS + WIPE_EVERY;
    }
    return time < this.wipeUntil ? "wipe" : "idle";
  }

  private setLoop(action: PixelActionName) {
    if (this.looping !== action) {
      this.looping = action;
      this.character.play(action);
    }
  }
}
