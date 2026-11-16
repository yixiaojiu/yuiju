import { type VRM, VRMUtils } from "@pixiv/three-vrm";
import {
  Color,
  HalfFloatType,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { PlayerSettings } from "../profile";
import type { CafeSession, CafeState, Cup, Customer } from "../session/state";
import { AvatarAnimator } from "./animator";
import { createDust, createLightCones } from "./atmosphere";
import { applyAvatarConfig, downloadAvatar, findPreset, loadAvatar } from "./avatar";
import { BARISTA_MOTION_SPEED, BaristaDirector } from "./barista";
import { BubbleLayer } from "./bubbles";
import {
  BARISTA_MODEL_URL,
  createCharacterLights,
  loadCharacter,
  updateCharacter,
} from "./character";
import { createCup } from "./cup";
import { loadEnvironment } from "./environment";
import { FirstPersonCamera } from "./first-person-camera";
import { createGradingPass } from "./grading";
import { animationUrl, downloadMixamo } from "./mixamo";
import {
  headingTowards,
  measureAvatar,
  readWalkArea,
  setSeatedSkirt,
  stepWithin,
  type WalkArea,
} from "./player";
import { createRecordPlayer } from "./record-player";

/** 玩家站在某处时，界面应该给出的交互提示。 */
export type Prompt = { type: "seat"; seat: number } | { type: "board" } | null;

/** 加载画面显示的进度：fraction 从 0 到 1，step 是当前在做的事。 */
export type LoadingProgress = { fraction: number; step: string };

/** 舞台通知页面的事件。 */
export type StageCallbacks = {
  onPrompt: (prompt: Prompt) => void;
  /** 进店后自己的模型加载完成、相机已经就位，页面可以揭开转场遮罩。 */
  onSelfReady: () => void;
  /** 鼠标锁定状态变化：锁定时移动鼠标转视角，解锁时鼠标显示出来。 */
  onPointerLockChange: (locked: boolean) => void;
};

const WALK_SPEED = 1.4;
/**
 * 第一人称的相机从两眼中间往身体前方挪出的距离，单位米。
 * 不挪的话低头时视线会穿进衣领，看到衣服和身体的内侧。
 */
const EYE_FORWARD_OFFSET = 0.05;
const SEAT_PROMPT_DISTANCE = 0.75;
const BOARD_PROMPT_DISTANCE = 0.9;
/** 坐下时髋部比坐垫顶面高出的距离，单位米。 */
const SEAT_HIP_OFFSET = 0.06;
/** 有人坐下时圆凳沿背对吧台的方向往后挪的距离，单位米；起身后挪回原位。坐得离吧台远一点，视野更舒服。 */
const STOOL_PULL_DISTANCE = 0.12;
/** 圆凳挪开或挪回用的时间，单位秒。 */
const STOOL_PULL_SECONDS = 0.3;
/** 每隔多久向服务端上报一次自己的位置，单位毫秒。 */
const MOVE_REPORT_INTERVAL_MS = 300;
const BARISTA_BUBBLE_ID = "barista";

/** 顾客用到的动作：站、走（前后左右）、坐。 */
const CUSTOMER_CLIPS = ["idle", "walk", "walk-backward", "strafe-left", "strafe-right", "sit-idle"];
/**
 * 她用到的动作：几种待机、在吧台内走动、送客、伸手把杯子放到台面上、说话时的手势和点头、思考、在咖啡机前按按钮。
 * 她是安静的少女，只用幅度小的动作；摇头晃脑、大幅扭身、张开双臂这类动作都不用。
 */
const BARISTA_CLIPS = [
  "idle",
  "walk",
  "idle-breathing",
  "idle-standing",
  "idle-weight-shift",
  "wave",
  "reaching-out",
  "talk-one-hand",
  "nod",
  "nod-thoughtful",
  "acknowledge",
  "thinking",
  "button-pushing",
];
const BARISTA_IDLES = ["idle", "idle-breathing", "idle-standing", "idle-weight-shift"];
const BARISTA_TALKS = ["talk-one-hand", "nod", "nod-thoughtful", "acknowledge"];
/** 杯子从她放下的交接点滑到顾客面前用的时间，单位秒。 */
const CUP_SLIDE_SECONDS = 0.9;
/** 她看向一位顾客后，视线停留多久再收回到正前方，单位秒。 */
const BARISTA_GAZE_SECONDS = 4;
/** 她每隔多久换一种待机站姿，单位秒。 */
const BARISTA_IDLE_SWITCH_SECONDS = 14;

/**
 * 按相对身体朝向的移动方向选走路动作：前进、后退、左右横移，没在动就是待机。
 * forward 和 right 是相对身体朝向的移动分量，只看正负和大小关系。
 */
function locomotionClip(forward: number, right: number) {
  if (Math.abs(forward) < 0.01 && Math.abs(right) < 0.01) {
    return "idle";
  }
  if (Math.abs(forward) >= Math.abs(right)) {
    return forward > 0 ? "walk" : "walk-backward";
  }
  return right > 0 ? "strafe-right" : "strafe-left";
}

type CustomerAvatar = {
  vrm: VRM;
  animator: AvatarAnimator;
  /** 姿势刚发生大的变化（坐下、站起），下一帧要按新姿势重置头发和裙子的物理。 */
  needsSpringReset: boolean;
};

/**
 * 咖啡店的 3D 舞台：加载场景和她，按 CafeState 摆放顾客、杯子和头顶气泡，处理玩家的走动和视角。
 * 舞台只读 CafeState，玩家的意图（坐下、点单等）由界面调用 CafeSession 表达。
 */
export class CafeStage {
  private readonly renderer = new WebGLRenderer();
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly bubbles: BubbleLayer;
  private readonly firstPersonCamera: FirstPersonCamera;
  private readonly timer = new Timer();
  private readonly dust = createDust(2.2, 2.3, 1.7);
  private readonly pressedKeys = new Set<string>();
  private readonly avatars = new Map<string, CustomerAvatar>();
  /** 正在加载模型的顾客，避免状态多次变化时重复加载。 */
  private readonly loadingAvatars = new Set<string>();
  private anchors: Record<string, Vector3> = {};
  /**
   * 四张圆凳：场景里的物体（木头和坐垫一个、金属脚踏一个）和它们的原位，背对吧台的方向，
   * 以及被拉开的程度（0 在原位，1 完全拉开）。
   */
  private stools: { objects: Object3D[]; rest: Vector3[]; away: Vector3; pull: number }[] = [];
  private walkArea: WalkArea | null = null;
  private barista: VRM | null = null;
  private baristaAnimator: AvatarAnimator | null = null;
  private baristaDirector: BaristaDirector | null = null;
  /** 她视线还要停留在当前对象上的秒数；为 0 时视线回到正前方。对象本身记在 barista.lookAt.target 上。 */
  private baristaGazeSeconds = 0;
  /** 吧台上画出来的杯子：杯子 id → 模型。 */
  private readonly cupObjects = new Map<string, ReturnType<typeof createCup>>();
  /** 已经出现在店内状态里、但她还没端到台面上的杯子 id，这些杯子先不画。 */
  private readonly undeliveredCups = new Set<string>();
  /** 已经从店内状态里收走、但她还没走过去拿的杯子，接着画在原处。 */
  private readonly uncollectedCups = new Map<string, Cup>();
  /**
   * 正在台面上滑动的杯子：杯子 id → 滑动进度（0 到 1）和方向。
   * 上杯时从交接点滑到顾客面前；收杯时从顾客面前滑回交接点，停在那里等她拿走。
   */
  private readonly cupSlides = new Map<
    string,
    { progress: number; toward: "customer" | "barista" }
  >();
  private baristaIdleTimer = 0;
  /** 上一次看到的店内状态，用来判断她该对什么做出反应（有人进店、她开口说话等）。 */
  private previousState: CafeState;
  private recordPlayer: ReturnType<typeof createRecordPlayer> | null = null;
  private prompt: Prompt = null;
  private lastMoveReport = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;

  private readonly container: HTMLDivElement;
  private readonly session: CafeSession;
  private readonly callbacks: StageCallbacks;

  constructor(container: HTMLDivElement, session: CafeSession, callbacks: StageCallbacks) {
    this.container = container;
    this.session = session;
    this.callbacks = callbacks;
    const width = container.clientWidth;
    const height = container.clientHeight;
    // 高分屏按 1.5 倍渲染：抗锯齿和泛光的开销随像素数增长，2 倍在笔记本上帧率不稳，1.5 倍肉眼几乎看不出差别。
    const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    // 保留颜色的色调映射，和 Blender 里预览渲染用的一致，网页里看到的明暗和颜色才和烘焙时相同。
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x0c0a0a);
    this.scene.add(this.dust);
    // 近裁剪距离 0.1 米：第一人称时离眼睛很近的衣领会被裁掉，低头不会看到衣服内侧。
    this.camera = new PerspectiveCamera(55, width / height, 0.1, 50);

    // 后处理：泛光让灯具和烛火有光晕，然后做色调映射，最后调色。接触暗部已经烘焙在光照里，不需要环境光遮蔽。
    this.composer = new EffectComposer(
      this.renderer,
      new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 }),
    );
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new Vector2(width, height), 0.18, 0.5, 1.0);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(createGradingPass());

    this.bubbles = new BubbleLayer(container);
    this.firstPersonCamera = new FirstPersonCamera(this.camera, this.renderer.domElement);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearPressedKeys);
    window.addEventListener("focusin", this.handleFocusIn);
    window.addEventListener("resize", this.handleResize);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    this.previousState = session.getState();
    this.unsubscribe = session.subscribe(() => {
      this.syncCustomers();
      this.reactBarista();
    });
  }

  /**
   * 加载场景和她。两个大文件同时开始下载，进度按已下载的字节数合计。
   * 加载完成后舞台还不渲染，页面在需要显示咖啡店时调用 setActive(true)。
   */
  async load(onProgress: (progress: LoadingProgress) => void) {
    const downloads = new Map<string, { loaded: number; total: number }>();
    let sceneFinished = false;
    function report() {
      let loaded = 0;
      let total = 0;
      for (const download of downloads.values()) {
        loaded += download.loaded;
        total += download.total;
      }
      const step = sceneFinished ? "她正在换上围裙" : "正在布置店面";
      onProgress({ fraction: total === 0 ? 0 : loaded / total, step });
    }
    function track(key: string) {
      return (event: ProgressEvent) => {
        // 服务器压缩传输时，total 是压缩后的大小，loaded 却按解压后计算，会超过 total，所以截到 total。
        downloads.set(key, { loaded: Math.min(event.loaded, event.total), total: event.total });
        report();
      };
    }
    const environmentLoading = loadEnvironment(track("scene"));
    const baristaDownload = downloadAvatar(BARISTA_MODEL_URL, track("barista"));
    const animationDownloads = [...new Set([...CUSTOMER_CLIPS, ...BARISTA_CLIPS])].map((name) =>
      downloadMixamo(animationUrl(name), track(`animation-${name}`)),
    );

    const environment = await environmentLoading;
    sceneFinished = true;
    report();
    if (this.disposed) {
      VRMUtils.deepDispose(environment.scene);
      environment.reflection.dispose();
      return;
    }
    this.scene.add(environment.scene);
    this.scene.environment = environment.reflection;
    this.anchors = environment.anchors;
    this.walkArea = readWalkArea(this.anchors);
    this.stools = [0, 1, 2, 3].map((seat) => {
      const objects = [`Stool_${seat}`, `Stool_${seat}_Metal`].map(
        (name) => environment.scene.getObjectByName(name)!,
      );
      const stool = this.anchors[`Anchor_stool_${seat}`];
      const cup = this.anchors[`Anchor_cup_${seat}`];
      return {
        objects,
        rest: objects.map((object) => object.position.clone()),
        away: new Vector3(stool.x - cup.x, 0, stool.z - cup.z).normalize(),
        pull: 0,
      };
    });
    const conePositions = Object.keys(this.anchors)
      .filter((name) => name.startsWith("Anchor_cone_"))
      .map((name) => this.anchors[name]);
    this.scene.add(createLightCones(conePositions));
    this.recordPlayer = createRecordPlayer(
      this.anchors.Anchor_record_center,
      this.anchors.Anchor_tonearm_pivot,
    );
    this.scene.add(this.recordPlayer.object);
    const baristaPosition = this.anchors.Anchor_character;
    this.scene.add(createCharacterLights(baristaPosition));
    this.camera.position.copy(this.anchors.Anchor_camera);
    this.camera.lookAt(this.anchors.Anchor_camera_target);

    await baristaDownload;
    await Promise.all(animationDownloads);
    const barista = await loadCharacter(baristaPosition, this.anchors.Anchor_camera);
    const baristaAnimator = new AvatarAnimator(barista);
    await baristaAnimator.load(BARISTA_CLIPS);
    if (this.disposed) {
      baristaAnimator.dispose();
      VRMUtils.deepDispose(barista.scene);
      return;
    }
    baristaAnimator.setBase("idle");
    this.baristaAnimator = baristaAnimator;
    this.baristaDirector = new BaristaDirector(barista, baristaAnimator, this.anchors);
    this.barista = barista;
    this.scene.add(barista.scene);
    this.bubbles.attach(BARISTA_BUBBLE_ID, barista.scene, measureAvatar(barista).headHeight + 0.32);
    this.syncCustomers();
    onProgress({ fraction: 1, step: "准备好了" });
  }

  /**
   * 把鼠标锁定在画布上，之后移动鼠标直接转视角。
   * 浏览器要求锁定由用户操作触发：第一次锁定和按 Esc 解除之后，必须在点击等操作里调用；
   * 由页面自己解除的锁定可以直接重新锁定。没有用户操作时浏览器会拒绝，鼠标保持显示，
   * 页面据此显示"点击继续"，所以这里不需要处理拒绝的原因。
   */
  async lockPointer() {
    try {
      await this.renderer.domElement.requestPointerLock();
    } catch {
      // 被拒绝时保持解锁状态，由页面的"点击继续"引导用户点击后重新锁定。
    }
  }

  /** 解除鼠标锁定，让鼠标显示出来操作界面。 */
  unlockPointer() {
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  /** 开始或停止渲染。捏人时咖啡店不在画面上，停止渲染省下性能。 */
  setActive(active: boolean) {
    this.renderer.setAnimationLoop(active ? (timestamp) => this.frame(timestamp) : null);
  }

  /** 应用玩家设定：视角灵敏度；标准画质关掉泛光并按 1 倍分辨率渲染。 */
  applySettings(settings: PlayerSettings) {
    this.firstPersonCamera.sensitivity = settings.mouseSensitivity;
    const high = settings.quality === "high";
    this.bloomPass.enabled = high;
    const pixelRatio = high ? Math.min(window.devicePixelRatio, 1.5) : 1;
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.handleResize();
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearPressedKeys);
    window.removeEventListener("focusin", this.handleFocusIn);
    window.removeEventListener("resize", this.handleResize);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    this.unlockPointer();
    this.renderer.setAnimationLoop(null);
    this.firstPersonCamera.dispose();
    this.bubbles.dispose();
    VRMUtils.deepDispose(this.scene);
    this.scene.environment?.dispose();
    for (const pass of this.composer.passes) {
      pass.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** 按 CafeState 增删顾客模型，并摆放坐着的顾客和他们的杯子。 */
  private syncCustomers() {
    if (!this.walkArea) {
      return;
    }
    const state = this.session.getState();
    if (state.selfId === null) {
      this.clearPressedKeys();
      this.camera.position.copy(this.anchors.Anchor_camera);
      this.camera.lookAt(this.anchors.Anchor_camera_target);
    }
    const presentIds = new Set(state.customers.map((customer) => customer.id));
    for (const [id, avatar] of this.avatars) {
      if (!presentIds.has(id)) {
        avatar.vrm.scene.removeFromParent();
        this.bubbles.detach(id);
        VRMUtils.deepDispose(avatar.vrm.scene);
        this.avatars.delete(id);
      }
    }
    for (const customer of state.customers) {
      const avatar = this.avatars.get(customer.id);
      if (!avatar) {
        this.loadCustomer(customer);
        continue;
      }
      this.placeSeated(customer, avatar);
    }
  }

  private async loadCustomer(customer: Customer) {
    if (this.loadingAvatars.has(customer.id)) {
      return;
    }
    this.loadingAvatars.add(customer.id);
    const vrm = await loadAvatar(findPreset(customer.avatar.presetId).url);
    this.loadingAvatars.delete(customer.id);
    const stillPresent = this.session
      .getState()
      .customers.some((current) => current.id === customer.id);
    if (this.disposed || !stillPresent) {
      VRMUtils.deepDispose(vrm.scene);
      return;
    }
    applyAvatarConfig(vrm, customer.avatar);
    const { headHeight } = measureAvatar(vrm);
    const animator = new AvatarAnimator(vrm);
    await animator.load(CUSTOMER_CLIPS);
    animator.setBase("idle");
    const stillHere = this.session
      .getState()
      .customers.some((current) => current.id === customer.id);
    if (this.disposed || !stillHere) {
      animator.dispose();
      VRMUtils.deepDispose(vrm.scene);
      return;
    }
    const avatar: CustomerAvatar = { vrm, animator, needsSpringReset: true };
    this.avatars.set(customer.id, avatar);
    this.scene.add(vrm.scene);
    this.bubbles.attach(customer.id, vrm.scene, headHeight + 0.32);
    if (customer.id === this.session.getState().selfId) {
      // 本人的发言在聊天框上方显示，不用头顶气泡。自己的身体始终显示，低头能看到；
      // 按 VRM 的第一人称标注把头部和头发从自己的视角里去掉，其他人看到的仍是完整模型。
      vrm.firstPerson!.setup();
      this.camera.layers.enable(vrm.firstPerson!.firstPersonOnlyLayer);
      this.camera.layers.disable(vrm.firstPerson!.thirdPersonOnlyLayer);
      const entrance = this.anchors.Anchor_entrance;
      const heading = headingTowards(this.anchors.Anchor_camera_target.clone().sub(entrance));
      vrm.scene.position.set(entrance.x, 0, entrance.z);
      vrm.scene.rotation.y = Math.PI + heading;
      this.firstPersonCamera.faceAlong(heading);
      this.callbacks.onSelfReady();
    } else {
      vrm.scene.position.set(customer.position.x, 0, customer.position.z);
      vrm.scene.rotation.y = Math.PI + customer.position.heading;
    }
    this.syncCustomers();
  }

  /** 坐着的顾客吸附到圆凳上、面朝吧台；刚站起来的顾客落在圆凳旁边。 */
  private placeSeated(customer: Customer, avatar: CustomerAvatar) {
    const scene = avatar.vrm.scene;
    const wasSeated = scene.userData.seat !== undefined && scene.userData.seat !== null;
    const isSelf = customer.id === this.session.getState().selfId;
    if (customer.seat === null) {
      if (wasSeated) {
        const stool = this.anchors[`Anchor_stool_${scene.userData.seat}`];
        const cup = this.anchors[`Anchor_cup_${scene.userData.seat}`];
        // 站起来后从圆凳往背对吧台的方向退一步。
        const away = new Vector3(stool.x - cup.x, 0, stool.z - cup.z).normalize();
        scene.position.set(stool.x + away.x * 0.45, 0, stool.z + away.z * 0.45);
        avatar.animator.setBase("idle");
        setSeatedSkirt(avatar.vrm, false);
        avatar.needsSpringReset = true;
      }
      scene.userData.seat = null;
      return;
    }
    const stool = this.anchors[`Anchor_stool_${customer.seat}`];
    const cupAnchor = this.anchors[`Anchor_cup_${customer.seat}`];
    // 坐姿动作里髋部的位置和圆凳不一定对得上，每帧在 alignSeated 里把髋部对准坐垫。
    const heading = headingTowards(new Vector3(cupAnchor.x - stool.x, 0, cupAnchor.z - stool.z));
    scene.rotation.y = Math.PI + heading;
    avatar.animator.setBase("sit-idle");
    setSeatedSkirt(avatar.vrm, true);
    if (!wasSeated) {
      scene.position.set(stool.x, 0, stool.z);
      avatar.needsSpringReset = true;
      if (isSelf) {
        this.firstPersonCamera.faceAlong(heading);
      }
    }
    scene.userData.seat = customer.seat;
  }

  /**
   * 按店内状态画吧台上的杯子，每张圆凳前的台面放一杯。她还没端上来的先不画，
   * 她还没走过去收的接着画；正在滑动的杯子每帧推进滑动进度。
   */
  private updateCups(state: CafeState, deltaSeconds: number) {
    const visible = [...state.cups, ...this.uncollectedCups.values()].filter(
      (cup) => !this.undeliveredCups.has(cup.id),
    );
    const visibleIds = new Set(visible.map((cup) => cup.id));
    for (const [id, cup] of this.cupObjects) {
      if (!visibleIds.has(id)) {
        cup.object.removeFromParent();
        VRMUtils.deepDispose(cup.object);
        this.cupObjects.delete(id);
      }
    }
    for (const cup of visible) {
      let model = this.cupObjects.get(cup.id);
      if (!model) {
        model = createCup();
        this.scene.add(model.object);
        this.cupObjects.set(cup.id, model);
      }
      const cupAnchor = this.anchors[`Anchor_cup_${cup.seat}`];
      const handoff = this.anchors[`Anchor_handoff_${cup.seat}`];
      const slide = this.cupSlides.get(cup.id);
      if (slide === undefined) {
        model.object.position.copy(cupAnchor);
      } else {
        slide.progress = Math.min(slide.progress + deltaSeconds / CUP_SLIDE_SECONDS, 1);
        // 先加速后减速，像被轻轻推过去。
        const eased = slide.progress * slide.progress * (3 - 2 * slide.progress);
        if (slide.toward === "customer") {
          model.object.position.lerpVectors(handoff, cupAnchor, eased);
        } else {
          model.object.position.lerpVectors(cupAnchor, handoff, eased);
        }
        if (slide.toward === "customer" && slide.progress === 1) {
          this.cupSlides.delete(cup.id);
        }
      }
      model.setRemaining(cup.remaining);
    }
  }

  private frame(timestamp: number) {
    this.timer.update(timestamp);
    const deltaSeconds = Math.min(this.timer.getDelta(), 1 / 30);
    const elapsed = this.timer.getElapsed();
    const now = Date.now();
    const state = this.session.getState();
    this.recordPlayer?.update(state.music, deltaSeconds);
    this.updateStools(state, deltaSeconds);
    this.dust.material.uniforms.time.value = elapsed;

    if (this.barista) {
      this.updateBaristaIdle(deltaSeconds);
      this.updateBaristaGaze(deltaSeconds);
      this.baristaDirector!.update(deltaSeconds);
      this.baristaAnimator!.update(deltaSeconds * BARISTA_MOTION_SPEED);
      updateCharacter(this.barista, elapsed, deltaSeconds);
      this.bubbles.show(BARISTA_BUBBLE_ID, state.barista.bubbles, null, now);
    }
    this.updateCups(state, deltaSeconds);

    for (const customer of state.customers) {
      const avatar = this.avatars.get(customer.id);
      if (!avatar) {
        continue;
      }
      if (customer.id === state.selfId) {
        this.moveSelf(customer, avatar, deltaSeconds, now);
      } else if (customer.seat === null) {
        // 其他顾客平滑地走向服务端给出的位置。
        const scene = avatar.vrm.scene;
        const target = new Vector3(customer.position.x, 0, customer.position.z);
        const offset = target.clone().sub(scene.position);
        scene.position.lerp(target, Math.min(deltaSeconds * 6, 1));
        const heading = customer.position.heading;
        scene.rotation.y = Math.PI + heading;
        // 移动方向投影到身体的前方和右方，决定是前进、后退还是横移。
        const forward = offset.x * Math.sin(heading) + offset.z * Math.cos(heading);
        const right = -offset.x * Math.cos(heading) + offset.z * Math.sin(heading);
        avatar.animator.setBase(locomotionClip(forward * 10, right * 10));
      }
      avatar.animator.update(deltaSeconds);
      if (customer.seat !== null) {
        this.alignSeated(customer.seat, avatar);
      }
      if (avatar.needsSpringReset) {
        // 姿势刚大幅变化：先按新姿势更新骨骼，再从这个姿势重新开始模拟头发和裙子。
        avatar.vrm.humanoid.update();
        avatar.vrm.scene.updateMatrixWorld(true);
        avatar.vrm.springBoneManager!.reset();
        avatar.needsSpringReset = false;
      }
      avatar.vrm.update(deltaSeconds);
      if (customer.id !== state.selfId) {
        this.bubbles.show(customer.id, customer.bubbles, customer.avatar.name, now);
      }
    }

    const current = this.session.getState();
    const self = current.customers.find((customer) => customer.id === current.selfId);
    const selfAvatar = self && this.avatars.get(self.id);
    if (selfAvatar) {
      const humanoid = selfAvatar.vrm.humanoid;
      const eyes = humanoid.getRawBoneNode("leftEye")!.getWorldPosition(new Vector3());
      eyes
        .add(humanoid.getRawBoneNode("rightEye")!.getWorldPosition(new Vector3()))
        .multiplyScalar(0.5);
      // 模型的 rotation.y 含有 VRM 0.x 的 π 修正，减掉后就是身体朝向。
      const bodyHeading = selfAvatar.vrm.scene.rotation.y - Math.PI;
      eyes.add(
        new Vector3(Math.sin(bodyHeading), 0, Math.cos(bodyHeading)).multiplyScalar(
          EYE_FORWARD_OFFSET,
        ),
      );
      this.firstPersonCamera.update(eyes);
    }
    this.updatePrompt(self ?? null, selfAvatar ?? null);
    this.composer.render(deltaSeconds);
    this.bubbles.renderer.render(this.scene, this.camera);
  }

  /**
   * 站着时身体始终朝向视线的水平方向；WASD 相对视线移动，后退就是倒着走，侧移就是横着走。
   * 撞到边界时沿边界滑动，定时上报位置。离店只能通过界面上的离店按钮。
   */
  private moveSelf(self: Customer, avatar: CustomerAvatar, deltaSeconds: number, now: number) {
    if (self.seat !== null) {
      return;
    }
    const scene = avatar.vrm.scene;
    // 视线在地面上的方向，抬头和低头不影响身体朝向和移动速度。
    const view = this.camera.getWorldDirection(new Vector3());
    view.y = 0;
    view.normalize();
    const heading = headingTowards(view);
    scene.rotation.y = Math.PI + heading;

    const forward = (this.pressedKeys.has("KeyW") ? 1 : 0) - (this.pressedKeys.has("KeyS") ? 1 : 0);
    const right = (this.pressedKeys.has("KeyD") ? 1 : 0) - (this.pressedKeys.has("KeyA") ? 1 : 0);
    avatar.animator.setBase(locomotionClip(forward, right));
    if (forward === 0 && right === 0) {
      return;
    }
    const rightDirection = new Vector3(-view.z, 0, view.x);
    const direction = view
      .clone()
      .multiplyScalar(forward)
      .addScaledVector(rightDirection, right)
      .normalize();
    const target = scene.position.clone().addScaledVector(direction, WALK_SPEED * deltaSeconds);
    scene.position.copy(stepWithin(this.walkArea!, scene.position, target));
    if (now - this.lastMoveReport > MOVE_REPORT_INTERVAL_MS) {
      this.lastMoveReport = now;
      this.session.move({ x: scene.position.x, z: scene.position.z, heading });
    }
  }

  /** 圆凳坐垫顶面中心的当前位置，包含有人坐下时往后挪的距离。 */
  private stoolPosition(seat: number) {
    const { away, pull } = this.stools[seat];
    // 先加速后减速，像被人轻轻拉开。
    const eased = pull * pull * (3 - 2 * pull);
    return this.anchors[`Anchor_stool_${seat}`]
      .clone()
      .addScaledVector(away, STOOL_PULL_DISTANCE * eased);
  }

  /** 有人坐着的圆凳往后挪，空着的挪回原位。 */
  private updateStools(state: CafeState, deltaSeconds: number) {
    const occupied = new Set(state.customers.map((customer) => customer.seat));
    for (const [seat, stool] of this.stools.entries()) {
      const step = deltaSeconds / STOOL_PULL_SECONDS;
      stool.pull = occupied.has(seat)
        ? Math.min(stool.pull + step, 1)
        : Math.max(stool.pull - step, 0);
      const offset = this.stoolPosition(seat).sub(this.anchors[`Anchor_stool_${seat}`]);
      stool.objects.forEach((object, index) => {
        object.position.copy(stool.rest[index]).add(offset);
      });
    }
  }

  /** 把坐着的人的髋部对准圆凳坐垫上方：动作里的坐姿是按普通椅子做的，高度和前后位置都和圆凳不同。 */
  private alignSeated(seat: number, avatar: CustomerAvatar) {
    const stool = this.stoolPosition(seat);
    const scene = avatar.vrm.scene;
    scene.updateMatrixWorld(true);
    const hips = avatar.vrm.humanoid.getNormalizedBoneNode("hips")!.getWorldPosition(new Vector3());
    scene.position.add(
      new Vector3(stool.x - hips.x, stool.y + SEAT_HIP_OFFSET - hips.y, stool.z - hips.z),
    );
  }

  /**
   * 她对店里发生的事做出反应，展开成一串步骤交给行为编排按顺序执行：
   * - 开始做饮品：走到咖啡机前操作咖啡机；
   * - 饮品做好：走到点单时那张圆凳的对面，看着坐在那里的人，把杯子放在自己这一侧的台面上，
   *   杯子再滑到圆凳前（她不越过吧台），然后回到平时的位置。她不守在某位顾客面前，店里有多位顾客时也不会被谁拉走；
   * - 收走杯子（喝空了、点单的人离店了、有人请她收）：走到那张圆凳对面，杯子滑回她手边，她拿走后回到平时的位置；
   * - 换唱片：走到唱片机前放唱片，再回到平时的位置；
   * - 有人离店：挥手送客；
   * - 开口说话：看向最近说过话的顾客；手上没事时带一个说话手势，想回复时做思考的动作。
   *
   * 现在由界面根据店内状态的变化推断；之后她的 agent 会直接给出要做的事。
   */
  private reactBarista() {
    const next = this.session.getState();
    const previous = this.previousState;
    this.previousState = next;
    const director = this.baristaDirector;
    if (!director) {
      return;
    }
    const nextIds = new Set(next.customers.map((customer) => customer.id));

    if (next.barista.activity === "making" && previous.barista.activity !== "making") {
      director.enqueue([
        { type: "walk", spot: "machine" },
        { type: "play", clip: "button-pushing" },
      ]);
    }
    const previousCupIds = new Set(previous.cups.map((cup) => cup.id));
    const nextCupIds = new Set(next.cups.map((cup) => cup.id));
    for (const cup of next.cups) {
      if (previousCupIds.has(cup.id)) {
        continue;
      }
      this.undeliveredCups.add(cup.id);
      director.enqueue([
        { type: "walk", spot: `seat_${cup.seat}` },
        { type: "run", action: () => this.gazeAtSeat(cup.seat) },
        { type: "play", clip: "reaching-out" },
        {
          type: "run",
          action: () => {
            this.undeliveredCups.delete(cup.id);
            this.cupSlides.set(cup.id, { progress: 0, toward: "customer" });
          },
        },
        { type: "walk", spot: "home" },
      ]);
    }
    for (const cup of previous.cups) {
      if (nextCupIds.has(cup.id)) {
        continue;
      }
      this.uncollectedCups.set(cup.id, cup);
      director.enqueue([
        { type: "walk", spot: `seat_${cup.seat}` },
        { type: "run", action: () => this.gazeAtSeat(cup.seat) },
        {
          type: "run",
          action: () => this.cupSlides.set(cup.id, { progress: 0, toward: "barista" }),
        },
        { type: "play", clip: "reaching-out" },
        {
          type: "run",
          action: () => {
            this.uncollectedCups.delete(cup.id);
            this.cupSlides.delete(cup.id);
          },
        },
        { type: "walk", spot: "home" },
      ]);
    }
    if (next.music.record?.id !== previous.music.record?.id) {
      director.enqueue([
        { type: "walk", spot: "record" },
        { type: "play", clip: "reaching-out" },
        { type: "walk", spot: "home" },
      ]);
    }
    if (previous.customers.some((customer) => !nextIds.has(customer.id))) {
      director.enqueue([{ type: "play", clip: "wave" }]);
    }

    const newBubble = next.barista.bubbles.at(-1);
    if (!newBubble || newBubble === previous.barista.bubbles.at(-1)) {
      return;
    }
    // 她说话是在回应最近开口的顾客。还没加载出模型的顾客看不到，不在候选里。
    let speaker: Customer | null = null;
    for (const customer of next.customers) {
      const spokeAt = customer.bubbles.at(-1)?.createdAt;
      if (
        spokeAt !== undefined &&
        this.avatars.has(customer.id) &&
        (!speaker || spokeAt > speaker.bubbles.at(-1)!.createdAt)
      ) {
        speaker = customer;
      }
    }
    if (speaker) {
      this.gazeAt(speaker.id);
    }
    if (!director.idle) {
      return;
    }
    this.baristaAnimator!.playOnce(
      newBubble.thinking
        ? "thinking"
        : BARISTA_TALKS[Math.floor(Math.random() * BARISTA_TALKS.length)],
    );
  }

  /**
   * 她看向一位顾客，停留一会儿再收回。平时她看正前方，不跟着任何人的视线走，
   * 否则无论玩家从哪个角度看，都会觉得她一直盯着自己。
   * 看玩家自己时对准相机（就是自己的眼睛），看其他顾客时对准他们的头。
   */
  /** 看向坐在这张圆凳上的人；没人坐就不看。 */
  private gazeAtSeat(seat: number) {
    const customer = this.session.getState().customers.find((current) => current.seat === seat);
    if (customer) {
      this.gazeAt(customer.id);
    }
  }

  private gazeAt(customerId: string) {
    // 她走到圆凳对面的路上，这位顾客可能已经离店了，这时就不看了。
    const avatar = this.avatars.get(customerId);
    if (!avatar) {
      return;
    }
    this.barista!.lookAt!.target =
      customerId === this.session.getState().selfId
        ? this.camera
        : avatar.vrm.humanoid.getNormalizedBoneNode("head");
    this.baristaGazeSeconds = BARISTA_GAZE_SECONDS;
  }

  /** 视线停留时间到了就收回到正前方。 */
  private updateBaristaGaze(deltaSeconds: number) {
    if (this.baristaGazeSeconds === 0) {
      return;
    }
    this.baristaGazeSeconds = Math.max(this.baristaGazeSeconds - deltaSeconds, 0);
    if (this.baristaGazeSeconds === 0) {
      this.barista!.lookAt!.target = null;
      this.barista!.lookAt!.reset();
    }
  }

  /** 她站着没事做时，每隔一阵子换一种待机站姿，看起来不那么僵。 */
  private updateBaristaIdle(deltaSeconds: number) {
    this.baristaIdleTimer += deltaSeconds;
    if (this.baristaIdleTimer < BARISTA_IDLE_SWITCH_SECONDS || !this.baristaDirector!.idle) {
      return;
    }
    this.baristaIdleTimer = 0;
    this.baristaAnimator!.setBase(BARISTA_IDLES[Math.floor(Math.random() * BARISTA_IDLES.length)]);
  }

  /** 站着时找最近的空圆凳或软木板，变化时通知界面。坐着时不给提示，由入座菜单接管。 */
  private updatePrompt(self: Customer | null, avatar: CustomerAvatar | null) {
    let prompt: Prompt = null;
    if (self && avatar && self.seat === null) {
      const position = avatar.vrm.scene.position;
      const taken = new Set(this.session.getState().customers.map((customer) => customer.seat));
      let nearestDistance = SEAT_PROMPT_DISTANCE;
      for (let seat = 0; seat < 4; seat++) {
        const stool = this.anchors[`Anchor_stool_${seat}`];
        const distance = Math.hypot(stool.x - position.x, stool.z - position.z);
        if (!taken.has(seat) && distance < nearestDistance) {
          nearestDistance = distance;
          prompt = { type: "seat", seat };
        }
      }
      const board = this.anchors.Anchor_corkboard;
      if (
        !prompt &&
        Math.hypot(board.x - position.x, board.z - position.z) < BOARD_PROMPT_DISTANCE
      ) {
        prompt = { type: "board" };
      }
    }
    const changed =
      prompt?.type !== this.prompt?.type ||
      (prompt?.type === "seat" && this.prompt?.type === "seat" && prompt.seat !== this.prompt.seat);
    if (changed) {
      this.prompt = prompt;
      this.callbacks.onPrompt(prompt);
    }
  }

  /** 输入框获得焦点时按键用来打字，不移动角色。 */
  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      document.querySelector('[role="dialog"]')
    ) {
      return;
    }
    this.pressedKeys.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.pressedKeys.delete(event.code);
  };

  private clearPressedKeys = () => {
    this.pressedKeys.clear();
  };

  private handleFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      document.querySelector('[role="dialog"]')
    ) {
      this.clearPressedKeys();
    }
  };

  private handlePointerLockChange = () => {
    this.callbacks.onPointerLockChange(document.pointerLockElement === this.renderer.domElement);
  };

  private handleResize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bubbles.setSize(width, height);
  };
}
