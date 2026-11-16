import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import {
  AnimationClip,
  type Group,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

/** Mixamo 骨骼名到 VRM 标准骨骼名的对应关系。 */
const MIXAMO_TO_VRM: Record<string, VRMHumanBoneName> = {
  mixamorigHips: "hips",
  mixamorigSpine: "spine",
  mixamorigSpine1: "chest",
  mixamorigSpine2: "upperChest",
  mixamorigNeck: "neck",
  mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder",
  mixamorigLeftArm: "leftUpperArm",
  mixamorigLeftForeArm: "leftLowerArm",
  mixamorigLeftHand: "leftHand",
  mixamorigLeftHandThumb1: "leftThumbMetacarpal",
  mixamorigLeftHandThumb2: "leftThumbProximal",
  mixamorigLeftHandThumb3: "leftThumbDistal",
  mixamorigLeftHandIndex1: "leftIndexProximal",
  mixamorigLeftHandIndex2: "leftIndexIntermediate",
  mixamorigLeftHandIndex3: "leftIndexDistal",
  mixamorigLeftHandMiddle1: "leftMiddleProximal",
  mixamorigLeftHandMiddle2: "leftMiddleIntermediate",
  mixamorigLeftHandMiddle3: "leftMiddleDistal",
  mixamorigLeftHandRing1: "leftRingProximal",
  mixamorigLeftHandRing2: "leftRingIntermediate",
  mixamorigLeftHandRing3: "leftRingDistal",
  mixamorigLeftHandPinky1: "leftLittleProximal",
  mixamorigLeftHandPinky2: "leftLittleIntermediate",
  mixamorigLeftHandPinky3: "leftLittleDistal",
  mixamorigRightShoulder: "rightShoulder",
  mixamorigRightArm: "rightUpperArm",
  mixamorigRightForeArm: "rightLowerArm",
  mixamorigRightHand: "rightHand",
  mixamorigRightHandThumb1: "rightThumbMetacarpal",
  mixamorigRightHandThumb2: "rightThumbProximal",
  mixamorigRightHandThumb3: "rightThumbDistal",
  mixamorigRightHandIndex1: "rightIndexProximal",
  mixamorigRightHandIndex2: "rightIndexIntermediate",
  mixamorigRightHandIndex3: "rightIndexDistal",
  mixamorigRightHandMiddle1: "rightMiddleProximal",
  mixamorigRightHandMiddle2: "rightMiddleIntermediate",
  mixamorigRightHandMiddle3: "rightMiddleDistal",
  mixamorigRightHandRing1: "rightRingProximal",
  mixamorigRightHandRing2: "rightRingIntermediate",
  mixamorigRightHandRing3: "rightRingDistal",
  mixamorigRightHandPinky1: "rightLittleProximal",
  mixamorigRightHandPinky2: "rightLittleIntermediate",
  mixamorigRightHandPinky3: "rightLittleDistal",
  mixamorigLeftUpLeg: "leftUpperLeg",
  mixamorigLeftLeg: "leftLowerLeg",
  mixamorigLeftFoot: "leftFoot",
  mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg",
  mixamorigRightLeg: "rightLowerLeg",
  mixamorigRightFoot: "rightFoot",
  mixamorigRightToeBase: "rightToes",
};

/** 动作文件的地址，name 是动作名（和文件名一致）。 */
export function animationUrl(name: string) {
  return `/large/animations/${name}.fbx`;
}

/** 已经开始下载的动作文件，按地址缓存。每个模型都要单独套用一次，但文件只下载一次。 */
const downloads = new Map<string, Promise<Group>>();

/** 下载动作文件。onProgress 只在第一次下载时生效；之后对同一地址的调用直接复用已有的下载。 */
export function downloadMixamo(url: string, onProgress?: (event: ProgressEvent) => void) {
  if (!downloads.has(url)) {
    downloads.set(url, new FBXLoader().loadAsync(url, onProgress));
  }
  return downloads.get(url)!;
}

/**
 * 把一个 Mixamo 动作套用到某个 VRM 模型上，得到可以直接用 AnimationMixer 播放的动作。
 *
 * 做法参照 three-vrm 官方示例：每根骨骼的旋转按 Mixamo 骨架的静止姿势换算到 VRM 的标准骨骼上；
 * 髋部位移按两边髋部高度的比例缩放。VRM 0.x 的坐标轴和 Mixamo 相反，需要翻转 x 和 z。
 * 模型里没有的骨骼（比如本模型没有 upperChest）直接跳过。
 */
export async function loadMixamoClip(url: string, vrm: VRM) {
  const asset = await downloadMixamo(url);
  const source = AnimationClip.findByName(asset.animations, "mixamo.com")!;
  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = [];
  const restRotationInverse = new Quaternion();
  const parentRestWorldRotation = new Quaternion();
  const rotation = new Quaternion();
  const position = new Vector3();

  const motionHipsHeight = asset.getObjectByName("mixamorigHips")!.position.y;
  const vrmHipsHeight =
    vrm.humanoid.getNormalizedBoneNode("hips")!.getWorldPosition(position).y -
    vrm.scene.getWorldPosition(new Vector3()).y;
  const hipsScale = vrmHipsHeight / motionHipsHeight;
  const flip = vrm.meta.metaVersion === "0";

  for (const track of source.tracks) {
    const [mixamoName, property] = track.name.split(".");
    const boneName = MIXAMO_TO_VRM[mixamoName];
    const vrmNode = boneName && vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!vrmNode) {
      continue;
    }
    const mixamoNode = asset.getObjectByName(mixamoName)!;
    mixamoNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoNode.parent!.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof QuaternionKeyframeTrack) {
      const values = Array.from(track.values);
      for (let index = 0; index < values.length; index += 4) {
        // 父骨骼静止时的世界旋转 × 这一帧的旋转 × 本骨骼静止时世界旋转的逆。
        rotation
          .fromArray(values, index)
          .premultiply(parentRestWorldRotation)
          .multiply(restRotationInverse)
          .toArray(values, index);
      }
      tracks.push(
        new QuaternionKeyframeTrack(
          `${vrmNode.name}.${property}`,
          Array.from(track.times),
          values.map((value, index) => (flip && index % 2 === 0 ? -value : value)),
        ),
      );
    } else if (track instanceof VectorKeyframeTrack) {
      tracks.push(
        new VectorKeyframeTrack(
          `${vrmNode.name}.${property}`,
          Array.from(track.times),
          Array.from(track.values).map(
            (value, index) => (flip && index % 3 !== 1 ? -value : value) * hipsScale,
          ),
        ),
      );
    }
  }
  return new AnimationClip(url, source.duration, tracks);
}
