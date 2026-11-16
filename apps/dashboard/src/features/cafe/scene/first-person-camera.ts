import type { PerspectiveCamera, Vector3 } from "three";

/**
 * 第一人称相机：放在玩家双眼之间，鼠标锁定在画布上时，移动鼠标直接转视角。
 * 锁定和解锁由舞台根据界面状态决定（打开面板、聊天、按住 Alt 时解锁，显示鼠标）。
 * 视线独立于身体朝向，侧移和后退时不会跟着身体转向。
 */
export class FirstPersonCamera {
  /** 水平角与玩家 heading 一致：0 看向 +z。 */
  private yaw = 0;
  private pitch = 0;
  /** 转视角的灵敏度倍率，来自玩家设定。 */
  sensitivity = 1;

  private readonly camera: PerspectiveCamera;
  private readonly element: HTMLElement;

  constructor(camera: PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;
    this.element = element;
    document.addEventListener("mousemove", this.handleMouseMove);
  }

  /** 每帧同步眼睛位置；站立和入座后的高度由模型骨骼决定。 */
  update(eyes: Vector3) {
    this.camera.position.copy(eyes);
    this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0, "YXZ");
  }

  /** 进店时看向店内，入座时水平看向吧台。 */
  faceAlong(heading: number) {
    this.yaw = heading;
    this.pitch = 0;
  }

  dispose() {
    document.removeEventListener("mousemove", this.handleMouseMove);
  }

  /** 只有鼠标锁定在画布上时才转视角；鼠标显示出来时移动鼠标只是在操作界面。 */
  private handleMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.element) {
      return;
    }
    this.yaw -= event.movementX * 0.0022 * this.sensitivity;
    this.pitch = Math.min(
      Math.max(this.pitch + event.movementY * 0.0022 * this.sensitivity, -Math.PI / 2 + 0.1),
      Math.PI / 2 - 0.1,
    );
  };
}
