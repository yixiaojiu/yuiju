import { CircleGeometry, Color, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import type { PixelActionName } from "../../scene/pixel-actions";
import {
  aimPixelCamera,
  createPixelCamera,
  createPixelCharacter,
  ELEVATION,
  HEAD_Y,
  PIXEL,
  snapToPixelGrid,
} from "../../scene/pixel-character";
import type { CafeSession, CafeState } from "../../session/state";
import { BaristaDirector } from "./barista-director";
import { buildFurniture } from "./furniture";
import {
  BOARD_REACH,
  BOARD_SPOT,
  CUSTOMER_RADIUS,
  ENTRANCE,
  OBSTACLES,
  ROOM,
  SEAT_REACH,
  SEATED_Y,
  STOOLS,
  WALKABLE,
} from "./layout";
import { createSceneMaterials } from "./pixel-material";
import { createPixelRenderer } from "./pixel-renderer";
import { buildProps, createSeatCups } from "./props";
import { buildRoom, CAFE_AMBIENT, CAFE_LIGHTS } from "./room";
import { createShapes } from "./shapes";

/** 玩家站在某处时，界面应该给出的交互提示。 */
export type PixelPrompt = { type: "seat"; seat: number } | { type: "board" } | null;

/** 一屏装下整家店需要的画面像素数；窗口装不下时相机跟着玩家走。 */
const PREFERRED_VIEW = { width: 320, height: 192 };
/** 相机追上目标的快慢：每秒缩小剩余距离的比例越大越快。 */
const CAMERA_FOLLOW = 6;
/** 玩家走路的速度，单位每秒。 */
const WALK_SPEED = 1.5;
/** 每隔多久向服务端上报一次自己的位置，单位毫秒。 */
const MOVE_REPORT_MS = 400;
/** 头顶标签（气泡、名字）挂在脚底上方多高的位置。 */
const LABEL_HEIGHT = 1.85;
/** 画面外的底色。 */
const BACKGROUND = new Color("#1c1412");

/** 世界里一点在画面竖直方向上的坐标：越高、越靠后，在画面上越靠上。 */
function screenY(y: number, z: number) {
  return y * Math.cos(ELEVATION) - z * Math.sin(ELEVATION);
}

type Character = ReturnType<typeof createPixelCharacter>;
/** 店里的一个人：像素角色模型、脚下的影子、当前循环的动作。 */
type Figure = { model: Character; shadow: Mesh; looping: PixelActionName | null };

/**
 * 像素咖啡馆的舞台：搭场景、放人、每帧更新和渲染。
 * 店内状态以 CafeSession 为准；玩家自己的站立位置由本地键盘操控，坐下、起身等操作由界面调用 session。
 */
export class PixelCafeStage {
  private readonly session: CafeSession;
  private readonly onPrompt: (prompt: PixelPrompt) => void;
  private readonly renderer: ReturnType<typeof createPixelRenderer>;
  private readonly camera = createPixelCamera(2, 2);
  /** 相机当前对准的位置：x 是地面横坐标，screenY 是画面竖直方向上的坐标。 */
  private readonly view = { x: 0, screenY: screenY(HEAD_Y, 0) };
  private readonly scene = new Scene();
  private readonly characters = new Scene();
  private readonly shapes = createShapes();
  private readonly materials = createSceneMaterials(CAFE_LIGHTS, CAFE_AMBIENT);
  private readonly cups: ReturnType<typeof createSeatCups>;
  private readonly shadowGeometry = new CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  private readonly shadowMaterial = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  private readonly barista: Figure;
  private readonly director: BaristaDirector;
  private readonly customers = new Map<string, Figure>();
  /** 界面登记的头顶标签：barista 或顾客 id → 元素。 */
  private readonly labels = new Map<string, HTMLElement>();
  private readonly keys = new Set<string>();
  /** 玩家自己站着时的位置和朝向。 */
  private readonly self = { x: ENTRANCE.x, z: ENTRANCE.z, heading: ENTRANCE.heading };
  private state: CafeState;
  private controlsEnabled = true;
  private prompt: PixelPrompt = null;
  private time = 0;
  private lastFrame = performance.now();
  private lastMoveReport = 0;
  private frame = 0;
  private readonly unsubscribe: () => void;

  constructor(
    container: HTMLElement,
    session: CafeSession,
    onPrompt: (prompt: PixelPrompt) => void,
  ) {
    this.session = session;
    this.onPrompt = onPrompt;
    this.renderer = createPixelRenderer(container, PREFERRED_VIEW);

    const room = new Group();
    buildRoom(room, this.shapes, this.materials);
    buildFurniture(room, this.shapes, this.materials);
    buildProps(room, this.shapes, this.materials);
    this.cups = createSeatCups(room, this.shapes, this.materials);
    this.scene.add(room);

    this.barista = this.createFigure();
    this.director = new BaristaDirector(this.barista.model);
    this.state = session.getState();
    // 角色创建后第一帧就要按相机对齐眼睛，先把相机对好。
    this.aimCamera(0);
    this.syncCustomers(this.state);
    this.unsubscribe = session.subscribe(() => {
      const next = session.getState();
      this.director.onStateChange(this.state, next, this.time);
      this.syncCustomers(next);
      this.state = next;
    });

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.frame = requestAnimationFrame(this.tick);
  }

  /** 打开面板或在输入框里打字时关闭键盘走动。 */
  setControlsEnabled(enabled: boolean) {
    this.controlsEnabled = enabled;
    if (!enabled) {
      this.keys.clear();
    }
  }

  /** 界面登记或注销一个头顶标签；舞台每帧把它移到对应角色的头顶。id 为 barista 或顾客 id。 */
  setLabel(id: string, element: HTMLElement | null) {
    if (element) {
      this.labels.set(id, element);
    } else {
      this.labels.delete(id);
    }
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    for (const figure of [this.barista, ...this.customers.values()]) {
      figure.model.dispose();
    }
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.materials.dispose();
    this.shapes.dispose();
    this.renderer.dispose();
  }

  private createFigure(): Figure {
    const model = createPixelCharacter(this.camera);
    this.characters.add(model.root);
    const shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.scale.set(0.3, 1, 0.2);
    this.scene.add(shadow);
    return { model, shadow, looping: null };
  }

  /** 按店内状态增减顾客；玩家自己进店时站到门口，起身时站到圆凳前面。 */
  private syncCustomers(next: CafeState) {
    for (const customer of next.customers) {
      if (!this.customers.has(customer.id)) {
        this.customers.set(customer.id, this.createFigure());
      }
    }
    for (const [id, figure] of this.customers) {
      if (!next.customers.some((customer) => customer.id === id)) {
        this.characters.remove(figure.model.root);
        this.scene.remove(figure.shadow);
        figure.model.dispose();
        this.customers.delete(id);
        // 界面要到下一次渲染才卸载他的标签，这期间不再摆放。
        this.labels.delete(id);
      }
    }
    const before = this.state.customers.find((customer) => customer.id === this.state.selfId);
    const after = next.customers.find((customer) => customer.id === next.selfId);
    if (after && next.selfId !== this.state.selfId) {
      Object.assign(this.self, { x: ENTRANCE.x, z: ENTRANCE.z, heading: ENTRANCE.heading });
    }
    if (after && before && before.seat !== null && after.seat === null) {
      const stool = STOOLS[before.seat];
      // 起身后站到圆凳背对吧台的一侧，背对吧台。
      Object.assign(this.self, {
        x: stool.x - 0.45 * Math.sin(stool.heading),
        z: stool.z - 0.45 * Math.cos(stool.heading),
        heading: stool.heading + Math.PI,
      });
    }
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.06, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;

    const selfCustomer = this.state.customers.find((customer) => customer.id === this.state.selfId);
    const walking = selfCustomer?.seat === null && this.moveSelf(dt, now);
    this.updatePrompt();

    this.director.update(dt, this.time);
    this.aimCamera(dt);
    this.place(
      this.barista,
      this.director.position.x,
      0,
      this.director.position.z,
      this.director.heading,
      null,
    );
    for (const customer of this.state.customers) {
      const figure = this.customers.get(customer.id)!;
      if (customer.seat !== null) {
        const stool = STOOLS[customer.seat];
        this.place(figure, stool.x, SEATED_Y, stool.z, stool.heading, "sit");
      } else if (customer.id === this.state.selfId) {
        this.place(
          figure,
          this.self.x,
          0,
          this.self.z,
          this.self.heading,
          walking ? "walk" : "idle",
        );
      } else {
        const { x, z, heading } = customer.position;
        this.place(figure, x, 0, z, heading, "idle");
      }
    }

    this.cups.show(
      STOOLS.map((_, seat) => {
        if (this.director.lingering.has(seat)) {
          return this.director.lingering.get(seat)!;
        }
        const cup = this.state.cups.find((item) => item.seat === seat);
        return cup && !this.director.carrying.has(seat) ? cup.remaining : null;
      }),
    );

    for (const figure of [this.barista, ...this.customers.values()]) {
      figure.model.animate(this.time);
    }
    this.placeLabels();
    this.renderer.render(this.scene, this.characters, this.camera, BACKGROUND);
  };

  /**
   * 相机对准玩家（还没进店时对准店中央），画面装得下整家店的方向上直接居中，
   * 装不下的方向上跟着玩家走，但不越过房间边缘。按整像素移动，脸部像素不会错位。
   */
  private aimCamera(dt: number) {
    const { width, height } = this.renderer.size;
    const inside = this.state.customers.some((customer) => customer.id === this.state.selfId);
    const target = inside ? this.self : { x: 0, z: 0 };
    const halfWidth = (width * PIXEL) / 2,
      halfHeight = (height * PIXEL) / 2;
    const left = ROOM.minX - 0.24,
      right = ROOM.maxX + 0.24;
    const bottom = screenY(-0.14, ROOM.maxZ),
      top = screenY(ROOM.wallHeight, ROOM.minZ);
    const wantX =
      right - left <= 2 * halfWidth
        ? (left + right) / 2
        : Math.min(Math.max(target.x, left + halfWidth), right - halfWidth);
    const wantY =
      top - bottom <= 2 * halfHeight
        ? (top + bottom) / 2
        : Math.min(Math.max(screenY(0.8, target.z), bottom + halfHeight), top - halfHeight);
    const follow = dt === 0 ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt);
    this.view.x += (wantX - this.view.x) * follow;
    this.view.screenY += (wantY - this.view.screenY) * follow;
    aimPixelCamera(this.camera, width, height, {
      x: this.view.x,
      z: 0,
      up: Math.round((this.view.screenY - screenY(HEAD_Y, 0)) / PIXEL),
    });
  }

  /** 按住的方向键移动玩家，挡住时沿障碍滑开。返回这一帧是否在走。 */
  private moveSelf(dt: number, now: number) {
    if (!this.controlsEnabled) {
      return false;
    }
    const right = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const forward = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    if (right === 0 && forward === 0) {
      return false;
    }
    const length = Math.hypot(right, forward);
    const stepX = (right / length) * WALK_SPEED * dt,
      stepZ = (forward / length) * WALK_SPEED * dt;
    if (!this.blocked(this.self.x + stepX, this.self.z)) {
      this.self.x += stepX;
    }
    if (!this.blocked(this.self.x, this.self.z + stepZ)) {
      this.self.z += stepZ;
    }
    this.self.heading = Math.atan2(right, forward);
    if (now - this.lastMoveReport > MOVE_REPORT_MS) {
      this.lastMoveReport = now;
      this.session.move({ ...this.self });
    }
    return true;
  }

  private blocked(x: number, z: number) {
    if (x < WALKABLE.minX || x > WALKABLE.maxX || z < WALKABLE.minZ || z > WALKABLE.maxZ) {
      return true;
    }
    return OBSTACLES.some((rect) => {
      const nearestX = Math.min(Math.max(x, rect.minX), rect.maxX);
      const nearestZ = Math.min(Math.max(z, rect.minZ), rect.maxZ);
      return Math.hypot(x - nearestX, z - nearestZ) < CUSTOMER_RADIUS;
    });
  }

  /** 站在空着的圆凳旁提示坐下，站在留言板前提示看留言；坐着时没有提示。 */
  private updatePrompt() {
    const self = this.state.customers.find((customer) => customer.id === this.state.selfId);
    let next: PixelPrompt = null;
    if (self && self.seat === null) {
      const seat = STOOLS.findIndex(
        ({ x, z }, index) =>
          Math.hypot(this.self.x - x, this.self.z - z) < SEAT_REACH &&
          !this.state.customers.some((customer) => customer.seat === index),
      );
      if (seat >= 0) {
        next = { type: "seat", seat };
      } else if (Math.hypot(this.self.x - BOARD_SPOT.x, this.self.z - BOARD_SPOT.z) < BOARD_REACH) {
        next = { type: "board" };
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(this.prompt)) {
      this.prompt = next;
      this.onPrompt(next);
    }
  }

  /** 把角色摆到对齐像素网格的位置上，影子贴地跟着；looping 为 null 时动作由别处决定。 */
  private place(
    figure: Figure,
    x: number,
    y: number,
    z: number,
    heading: number,
    looping: PixelActionName | null,
  ) {
    figure.model.root.position.copy(snapToPixelGrid(new Vector3(x, y, z)));
    figure.model.root.rotation.y = heading;
    figure.shadow.position.set(x, 0.005, z);
    if (looping && figure.looping !== looping) {
      figure.looping = looping;
      figure.model.play(looping);
    }
  }

  private placeLabels() {
    // 舞台先于界面订阅 session，界面登记标签时对应的顾客已经建好了。
    for (const [id, element] of this.labels) {
      const figure = id === "barista" ? this.barista : this.customers.get(id)!;
      const anchor = figure.model.root.position.clone().add(new Vector3(0, LABEL_HEIGHT, 0));
      const { x, y } = this.renderer.project(anchor, this.camera);
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (this.controlsEnabled && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      this.keys.add(event.code);
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private handleBlur = () => {
    this.keys.clear();
  };
}
