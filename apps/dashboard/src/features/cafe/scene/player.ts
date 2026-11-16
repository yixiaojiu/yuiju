import type { VRM } from "@pixiv/three-vrm";
import { Vector3 } from "three";

/** 顾客区的可走范围：若干矩形的并集，减去圆形障碍。坐标是网页 3D 场景的 x 和 z。 */
export type WalkArea = {
  rects: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  blocks: { x: number; z: number; radius: number }[];
};

/** 角色身体的半径加上小桌桌面的半径，走到这个距离以内就算撞上小桌。 */
const TABLE_BLOCK_RADIUS = 0.42;

/** 从场景文件的锚点读出可走范围；锚点由 packages/yuiju-assets/cafe-scene/build.py 导出。 */
export function readWalkArea(anchors: Record<string, Vector3>): WalkArea {
  const rects = ["a", "b"].map((name) => {
    const corner1 = anchors[`Anchor_walk_${name}_min`];
    const corner2 = anchors[`Anchor_walk_${name}_max`];
    return {
      minX: Math.min(corner1.x, corner2.x),
      maxX: Math.max(corner1.x, corner2.x),
      minZ: Math.min(corner1.z, corner2.z),
      maxZ: Math.max(corner1.z, corner2.z),
    };
  });
  const blocks = Object.keys(anchors)
    .filter((name) => name.startsWith("Anchor_block_table_"))
    .map((name) => ({ x: anchors[name].x, z: anchors[name].z, radius: TABLE_BLOCK_RADIUS }));
  return { rects, blocks };
}

function isWalkable(area: WalkArea, x: number, z: number) {
  const inside = area.rects.some(
    (rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ,
  );
  return (
    inside && area.blocks.every((block) => Math.hypot(x - block.x, z - block.z) >= block.radius)
  );
}

/**
 * 从 from 走向 to，撞到边界时沿着边界滑动：整步走不了就只走 x 或只走 z，都走不了就停在原地。
 * 返回实际走到的位置。
 */
export function stepWithin(area: WalkArea, from: Vector3, to: Vector3) {
  if (isWalkable(area, to.x, to.z)) {
    return to;
  }
  if (isWalkable(area, to.x, from.z)) {
    return new Vector3(to.x, from.y, from.z);
  }
  if (isWalkable(area, from.x, to.z)) {
    return new Vector3(from.x, from.y, to.z);
  }
  return from.clone();
}

/** 模型在站姿下的头部高度，头顶气泡和捏人镜头定位用。加载后、播放动作之前调用一次。 */
export function measureAvatar(vrm: VRM) {
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid.getNormalizedBoneNode("head")!.getWorldPosition(new Vector3());
  return { headHeight: head.y - vrm.scene.position.y };
}

/**
 * 切换裙摆的形态：模型里有一个 cafe_seated_skirt 表情，坐下时打开，把裙摆变成铺在腿上的样子，
 * 避免坐姿下裙摆被大腿顶起或穿进腿里。站起来时关闭。
 */
export function setSeatedSkirt(vrm: VRM, seated: boolean) {
  vrm.expressionManager!.setValue("cafe_seated_skirt", seated ? 1 : 0);
}

/** 模型正面朝 +z；朝向 heading（弧度）时面向 (sin heading, cos heading)。 */
export function headingTowards(direction: Vector3) {
  return Math.atan2(direction.x, direction.z);
}
