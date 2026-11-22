import {
  GridHelper,
  MeshBasicMaterial,
  type OrthographicCamera,
  PerspectiveCamera,
  type Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ELEVATION, OVERLAY_LAYER } from "./pixel-character";

/**
 * free：透视相机绕角色自由转动，看模型本身由哪些椭球、方块、截面拼成；
 * pixel：就是像素渲染用的那台 30° 正交相机，只是分辨率高，画面和 64×64 的结果一格对一个像素。
 */
export type ModelViewMode = "free" | "pixel";

/** 地面网格所在的渲染层，只有自由视角的相机看得到，像素渲染不受影响。 */
const GROUND_LAYER = 2;

/**
 * 三渲二「渲染之前」的样子：用高分辨率、抗锯齿把像素角色所在的场景再画一遍。
 * 和像素渲染共用同一个场景，每帧动画只更新一次，两边的姿势完全一致。
 * frame 是放画布的正方形框，按 column 的大小撑满它较短的一边。
 */
export function createModelView({
  column,
  frame,
  scene,
  pixelCamera,
}: {
  column: HTMLElement;
  frame: HTMLElement;
  scene: Scene;
  pixelCamera: OrthographicCamera;
}) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0, 0);
  const canvas = renderer.domElement;
  canvas.style.width = canvas.style.height = "100%";
  frame.appendChild(canvas);
  const observer = new ResizeObserver(() => {
    const side = Math.min(column.clientWidth, column.clientHeight);
    frame.style.width = frame.style.height = side + "px";
    renderer.setSize(side, side, false);
  });
  observer.observe(column);

  // 初始机位和像素相机同一个方向：正前方 30° 俯视，对着角色胸口。
  const freeCamera = new PerspectiveCamera(30, 1, 0.1, 50);
  const focus = new Vector3(0, 0.75, 0);
  freeCamera.position.set(0, focus.y + 5.5 * Math.sin(ELEVATION), 5.5 * Math.cos(ELEVATION));
  freeCamera.layers.enable(OVERLAY_LAYER);
  freeCamera.layers.enable(GROUND_LAYER);
  const controls = new OrbitControls(freeCamera, canvas);
  controls.target.copy(focus);
  controls.update();

  // 脚下的地面网格，一格 0.25（约 6 个屏幕像素），看得出角色多高、站在哪。
  const ground = new GridHelper(4, 16, "#8a9a82", "#aab8a2");
  ground.layers.set(GROUND_LAYER);
  scene.add(ground);

  // 线框叠在模型上：同一个场景换成线框材质再画一遍，不清屏，共用的材质不用改。
  const wire = new MeshBasicMaterial({
    color: "#3d2a36",
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });

  let mode: ModelViewMode = "free";
  let wireframe = false;

  return {
    setMode(next: ModelViewMode) {
      mode = next;
      controls.enabled = next === "free";
    },
    setWireframe(enabled: boolean) {
      wireframe = enabled;
    },
    render() {
      const camera = mode === "free" ? freeCamera : pixelCamera;
      renderer.render(scene, camera);
      if (wireframe) {
        // 情绪符号是贴片，地面本来就是线，都不画线框。
        camera.layers.disable(OVERLAY_LAYER);
        camera.layers.disable(GROUND_LAYER);
        scene.overrideMaterial = wire;
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = true;
        scene.overrideMaterial = null;
        camera.layers.enable(OVERLAY_LAYER);
        if (camera === freeCamera) {
          camera.layers.enable(GROUND_LAYER);
        }
      }
    },
    dispose() {
      observer.disconnect();
      controls.dispose();
      scene.remove(ground);
      ground.dispose();
      wire.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export type ModelView = ReturnType<typeof createModelView>;
