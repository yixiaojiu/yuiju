import { type VRM, VRMUtils } from "@pixiv/three-vrm";
import {
  CanvasTexture,
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  Timer,
  WebGLRenderer,
} from "three";
import type { AvatarConfig } from "../session/state";
import { AvatarAnimator } from "./animator";
import { applyAvatarConfig, findPreset, loadAvatar, type StudioShot } from "./avatar";
import { updateCharacter } from "./character";
import { measureAvatar } from "./player";

/** 头像缩略图的边长，单位像素。 */
const THUMBNAIL_SIZE = 192;

/**
 * 捏人场景：一个独立的轻量渲染器，背景透明（由页面的 CSS 渐变衬底），脚下一圈柔光地台。
 * 角色站在原点，拖动旋转角色，滚轮缩放，镜头在全身、半身、脸之间平滑切换。
 * 确认形象后由页面释放，和咖啡店的舞台互不影响。
 */
export class AvatarStudio {
  private readonly renderer = new WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly timer = new Timer();
  private readonly container: HTMLDivElement;
  private vrm: VRM | null = null;
  private animator: AvatarAnimator | null = null;
  private presetId: string | null = null;
  private headHeight = 1.3;
  /** 相机当前看向的高度和距离，每帧向目标值靠近，切换镜头时就会平滑移动。 */
  private focusHeight = 0.68;
  private distance = 3.9;
  private targetFocusHeight = 0.68;
  private targetDistance = 3.9;
  private dragging = false;
  private turn = 0;
  private disposed = false;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = NeutralToneMapping;
    container.appendChild(this.renderer.domElement);
    this.camera = new PerspectiveCamera(
      30,
      container.clientWidth / container.clientHeight,
      0.05,
      20,
    );

    // 摄影棚布光：柔和的天光打底，正面偏暖的主光，背后一道轮廓光把人从背景里勾出来。
    this.scene.add(new HemisphereLight(0xfff4e6, 0x8a6f5a, 1.2));
    const key = new DirectionalLight(0xffe8d0, 1.6);
    key.position.set(1.2, 2, 2.5);
    this.scene.add(key);
    const rim = new DirectionalLight(0xffd9a8, 1.4);
    rim.position.set(-1.5, 1.8, -2);
    this.scene.add(rim);
    this.scene.add(createFloorGlow());

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("wheel", this.handleWheel, { passive: true });
    window.addEventListener("resize", this.handleResize);
    this.renderer.setAnimationLoop((timestamp) => this.frame(timestamp));
  }

  /** 显示一份捏人配置。换了预置形象时重新加载模型，否则只重新染色和开关配饰。 */
  async show(config: AvatarConfig) {
    if (config.presetId === this.presetId && this.vrm) {
      applyAvatarConfig(this.vrm, config);
      return;
    }
    this.presetId = config.presetId;
    const vrm = await loadAvatar(findPreset(config.presetId).url);
    // 捏人时角色播放待机动作，看起来是活的。
    const animator = new AvatarAnimator(vrm);
    await animator.load(["idle"]);
    if (this.disposed || this.presetId !== config.presetId) {
      animator.dispose();
      VRMUtils.deepDispose(vrm.scene);
      return;
    }
    if (this.vrm) {
      this.animator!.dispose();
      this.vrm.scene.removeFromParent();
      VRMUtils.deepDispose(this.vrm.scene);
    }
    animator.setBase("idle");
    this.animator = animator;
    applyAvatarConfig(vrm, config);
    vrm.lookAt!.target = this.camera;
    // 模型默认背对相机，转过来面向镜头，再带一点侧身。
    this.turn = Math.PI - 0.35;
    vrm.scene.rotation.y = this.turn;
    this.headHeight = measureAvatar(vrm).headHeight;
    this.vrm = vrm;
    this.scene.add(vrm.scene);
  }

  /** 切换镜头，相机会平滑移动过去。 */
  setShot(shot: StudioShot) {
    const shots: Record<StudioShot, { height: number; distance: number }> = {
      // 全身要把帽子和头发顶端也框进来（头部骨骼以上还有约 0.25 米），脚下还要给镜头按钮留出位置。
      full: { height: this.headHeight * 0.56, distance: 3.9 },
      half: { height: this.headHeight * 0.88, distance: 1.6 },
      face: { height: this.headHeight + 0.03, distance: 0.75 },
    };
    this.targetFocusHeight = shots[shot].height;
    this.targetDistance = shots[shot].distance;
  }

  /** 以脸部镜头截一张方形头像，返回 data URL。截完恢复原来的镜头。 */
  captureThumbnail() {
    const camera = this.camera.clone();
    camera.aspect = 1;
    camera.position.set(0, this.headHeight + 0.03, 0.75);
    camera.lookAt(0, this.headHeight + 0.01, 0);
    camera.updateProjectionMatrix();
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    const size = Math.min(width, height);
    this.renderer.setViewport(
      0,
      0,
      size / this.renderer.getPixelRatio(),
      size / this.renderer.getPixelRatio(),
    );
    this.renderer.render(this.scene, camera);
    // 渲染后立即从画布上取图，不需要保留绘图缓冲。画面在画布左下角的正方形区域。
    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    canvas
      .getContext("2d")!
      .drawImage(
        this.renderer.domElement,
        0,
        height - size,
        size,
        size,
        0,
        0,
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE,
      );
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    return canvas.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("resize", this.handleResize);
    VRMUtils.deepDispose(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(timestamp: number) {
    this.timer.update(timestamp);
    const deltaSeconds = this.timer.getDelta();
    const ease = Math.min(deltaSeconds * 6, 1);
    this.focusHeight += (this.targetFocusHeight - this.focusHeight) * ease;
    this.distance += (this.targetDistance - this.distance) * ease;
    // 相机从正前方略微偏右上看过去，比正对着更有立体感。
    this.camera.position.set(
      this.distance * 0.18,
      this.focusHeight + this.distance * 0.08,
      this.distance,
    );
    this.camera.lookAt(0, this.focusHeight, 0);
    if (this.vrm) {
      this.vrm.scene.rotation.y = this.turn;
      this.animator!.update(deltaSeconds);
      updateCharacter(this.vrm, this.timer.getElapsed(), deltaSeconds);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button === 0) {
      this.dragging = true;
    }
  };

  private handlePointerUp = () => {
    this.dragging = false;
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (this.dragging) {
      this.turn += event.movementX * 0.01;
    }
  };

  private handleWheel = (event: WheelEvent) => {
    this.targetDistance = Math.min(Math.max(this.targetDistance + event.deltaY * 0.002, 0.6), 4.5);
  };

  private handleResize = () => {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };
}

/** 脚下的一圈柔光：中心是暖白色，向外渐隐到透明。 */
function createFloorGlow() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 236, 205, 0.9)");
  gradient.addColorStop(0.45, "rgba(255, 220, 175, 0.45)");
  gradient.addColorStop(1, "rgba(255, 210, 160, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const floor = new Mesh(
    new CircleGeometry(0.9, 48),
    new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  return floor;
}
