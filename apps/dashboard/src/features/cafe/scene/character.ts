import type { VRM } from "@pixiv/three-vrm";
import { Group, HemisphereLight, SpotLight, type Vector3 } from "three";
import { loadAvatar } from "./avatar";

/** AI 角色的模型文件。 */
export const BARISTA_MODEL_URL = "/large/yuuno-skirt-fixed-4k-web-seated.vrm";

/**
 * 加载角色模型，摆成自然站姿，放到 position（脚底）并让身体朝向 faceTarget 所在的方向。
 * 视线默认看正前方，需要看人时由舞台设置视线目标。
 */
export async function loadCharacter(position: Vector3, faceTarget: Vector3) {
  const vrm = await loadAvatar(BARISTA_MODEL_URL);
  vrm.expressionManager!.setValue("relaxed", 0.25);

  vrm.scene.position.copy(position);
  // rotateVRM0 之后模型的正面朝 +z，绕 y 轴转到面向 faceTarget。
  vrm.scene.rotation.y = Math.PI + Math.atan2(faceTarget.x - position.x, faceTarget.z - position.z);
  vrm.scene.updateMatrixWorld(true);
  vrm.springBoneManager!.reset();
  return vrm;
}

/**
 * 只为角色服务的灯光。环境用的是烘焙光照，不受这些灯影响；角色的卡通材质需要实时光源。
 * 灯光按她所在位置的烘焙光照来配：头顶偏暖的主光、来自顾客区的偏中性补光，保证奶黄和浅蓝不被染偏。
 * position 是角色脚底的位置。
 */
export function createCharacterLights(position: Vector3) {
  const lights = new Group();
  lights.add(new HemisphereLight(0xffe4c8, 0x7a5c46, 0.42));

  const key = new SpotLight(0xffe0bc, 1.8, 6, 0.6, 1, 2);
  key.position.set(position.x - 0.6, 2.3, position.z + 0.4);
  key.target.position.set(position.x, 1.15, position.z);
  lights.add(key, key.target);

  const fill = new SpotLight(0xfff2e6, 1.0, 6, 0.6, 1, 2);
  fill.position.set(position.x - 1.6, 1.7, position.z + 1.4);
  fill.target.position.set(position.x, 1.2, position.z);
  lights.add(fill, fill.target);
  return lights;
}

/**
 * 每帧更新角色：定时眨眼，并把标准骨骼同步到模型骨骼、推进头发物理和视线跟随。
 * 身体动作由动作控制器负责，要在调用这里之前推进。
 * elapsedSeconds 是场景启动后的总时间，deltaSeconds 是距上一帧的时间。
 */
export function updateCharacter(vrm: VRM, elapsedSeconds: number, deltaSeconds: number) {
  // 每 4 秒眨一次眼，一次眨眼持续 0.16 秒。
  const blinkPhase = elapsedSeconds % 4;
  vrm.expressionManager!.setValue(
    "blink",
    blinkPhase < 0.16 ? Math.sin((blinkPhase / 0.16) * Math.PI) : 0,
  );
  // 切换标签页回来时两帧之间可能隔了很久，一步模拟这么长的时间弹簧骨骼会失稳，裙子和头发会飞出去。
  vrm.update(Math.min(deltaSeconds, 1 / 30));
}
