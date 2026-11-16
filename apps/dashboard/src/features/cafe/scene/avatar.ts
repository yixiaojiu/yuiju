import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { Color, FileLoader, Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarConfig } from "../session/state";

/** 捏人场景的三个镜头：全身、半身、脸。 */
export type StudioShot = "full" | "half" | "face";

/**
 * 预置的玩家形象。捏人时能换色的部位和能开关的配饰，都按材质名里的片段找到模型上对应的网格。
 * 每个部位给出一排推荐色（和贴图相乘，所以偏浅、偏柔和），以及编辑这个部位时相机切到的镜头。
 *
 * 目前只有一个临时预置：借用 AI 角色的模型来开发移动、坐下和捏人。
 * 用 VRoid Studio 做好正式的预置模型后，在这里换成新的文件和材质名。
 */
export const AVATAR_PRESETS = [
  {
    id: "yuuno",
    label: "临时形象",
    url: "/large/yuuno-skirt-fixed-4k-web-seated.vrm",
    parts: [
      {
        id: "hair",
        label: "发色",
        materials: ["Hair", "hair"],
        shot: "half" as StudioShot,
        swatches: [
          "#f6d7c3",
          "#e8b98f",
          "#b98a6a",
          "#8a6a5a",
          "#f3b8c4",
          "#c9b6e8",
          "#a9cfe8",
          "#d6e6b8",
        ],
      },
      {
        id: "top",
        label: "上衣",
        materials: ["Coat"],
        shot: "half" as StudioShot,
        swatches: [
          "#fbe9c8",
          "#f6c9c9",
          "#c9dcf6",
          "#cfe8c9",
          "#e3d1f2",
          "#d9c2a6",
          "#b8b8c8",
          "#f2f2f2",
        ],
      },
      {
        id: "skirt",
        label: "下装",
        materials: ["Skirt"],
        shot: "full" as StudioShot,
        swatches: [
          "#c9e3f6",
          "#f6c9d6",
          "#d2c2f2",
          "#c9f0d8",
          "#f6e2b8",
          "#c8b4a0",
          "#9aa4b8",
          "#f2f2f2",
        ],
      },
    ],
    accessories: [{ id: "beret", label: "贝雷帽", materials: ["Beret", "Hat bow"] }],
  },
];

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export function findPreset(presetId: string) {
  return AVATAR_PRESETS.find((preset) => preset.id === presetId)!;
}

/** 一个预置形象的默认配置：不染色（白色即原色），配饰全部打开。 */
export function defaultAvatarConfig(preset: AvatarPreset, name: string): AvatarConfig {
  return {
    presetId: preset.id,
    colors: Object.fromEntries(preset.parts.map((part) => [part.id, "#ffffff"])),
    accessories: preset.accessories.map((accessory) => accessory.id),
    name,
  };
}

/** 已经开始下载的模型文件，按地址缓存。同一个模型被多人使用时只下载一次，进店前也能先下载好。 */
const avatarDownloads = new Map<string, Promise<ArrayBuffer>>();

/**
 * 下载模型文件。onProgress 只在第一次下载时生效；之后对同一地址的调用直接复用已有的下载。
 */
export function downloadAvatar(url: string, onProgress?: (event: ProgressEvent) => void) {
  if (!avatarDownloads.has(url)) {
    const loader = new FileLoader().setResponseType("arraybuffer");
    avatarDownloads.set(url, loader.loadAsync(url, onProgress) as Promise<ArrayBuffer>);
  }
  return avatarDownloads.get(url)!;
}

/**
 * 加载一个 VRM 模型并摆成自然站姿。AI 角色、玩家和其他顾客都用它加载。
 * 返回的模型正面朝 +z，脚底在原点。VRM 0.x 的场景根节点保留了 π 的朝向修正，
 * 后续设置世界朝向时也需要计入这个角度。
 */
export async function loadAvatar(url: string) {
  const data = await downloadAvatar(url);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  // 每次都从下载好的数据重新解析，得到独立的模型实例，各自的染色和骨骼互不影响。
  const gltf = await loader.parseAsync(data, "");
  const vrm: VRM = gltf.userData.vrm;

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  // 模型是 VRM 0.x，默认背对 +z，转成和 VRM 1.0 一致的朝向。
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((object) => {
    // 蒙皮网格的包围盒不随骨骼更新，关掉视锥剔除，避免转动视角时身体局部消失。
    object.frustumCulled = false;
  });

  // 模型默认是 T 字姿势：把上臂放下来并略微外展，让手离开裙摆；小臂微微内收。
  const humanoid = vrm.humanoid;
  humanoid.getNormalizedBoneNode("leftUpperArm")!.rotation.z = 1.1;
  humanoid.getNormalizedBoneNode("rightUpperArm")!.rotation.z = -1.1;
  humanoid.getNormalizedBoneNode("leftLowerArm")!.rotation.z = 0.14;
  humanoid.getNormalizedBoneNode("rightLowerArm")!.rotation.z = -0.14;
  // 裙子和头发由弹簧骨骼驱动，并且会被手臂的碰撞体推开。弹簧的初始状态是按 T 字姿势算的，
  // 而姿势是加载后一次性摆好的：先把姿势同步到骨骼，再让弹簧从"手臂已经放下"的状态重新开始，
  // 避免第一帧手臂的碰撞体从 T 字位置瞬间扫过头发和裙子。
  humanoid.update();
  vrm.scene.updateMatrixWorld(true);
  vrm.springBoneManager!.reset();
  return vrm;
}

/**
 * 把捏人配置应用到模型上：按部位给材质染色（颜色和贴图相乘，白色即原色），按配饰显示或隐藏网格。
 * 每个模型实例的材质是独立的，染色不会影响到其他人。
 */
export function applyAvatarConfig(vrm: VRM, config: AvatarConfig) {
  const preset = findPreset(config.presetId);
  vrm.scene.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const part = preset.parts.find((candidate) =>
        candidate.materials.some((fragment) => material.name.includes(fragment)),
      );
      if (part) {
        // 第一次染色前记下原色，之后每次都从原色开始相乘。
        material.userData.baseColor ??= material.color.clone();
        material.color
          .copy(material.userData.baseColor)
          .multiply(new Color(config.colors[part.id]));
      }
      const accessory = preset.accessories.find((candidate) =>
        candidate.materials.some((fragment) => material.name.includes(fragment)),
      );
      if (accessory) {
        object.visible = config.accessories.includes(accessory.id);
      }
    }
  });
}
