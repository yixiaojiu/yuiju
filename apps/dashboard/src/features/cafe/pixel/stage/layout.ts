import { servedCupPosition } from "../../scene/pixel-actions";

/**
 * 像素咖啡馆的布局，单位是世界单位（像素角色身高约 1.6，一个屏幕像素是 0.04）。
 * x 向右，z 指向画面前方（店门一侧），y 向上。相机从店门一侧往里俯视，前墙剖开不画。
 *
 * 构图按像素游戏的习惯：她在画面正中、正面朝镜头，后墙是主要的展示面。
 * 家具和小道具按接近真实的比例放大，每件东西都有足够的像素画出形状；
 * 吧台和桌子的高度保持在 Q 版角色的腰部，她手上的动作露在台面上。
 *
 * 吧台是开口朝后墙的コ字：前段正对镜头，只放矮的蛋糕和收银机，挡住她的下半身；
 * 四张圆凳分在左右两翼外侧，顾客侧着坐，不会挡住她。
 */

export const ROOM = { minX: -6, maxX: 6, minZ: -4, maxZ: 3.6, wallHeight: 3 };

/** 吧台各段的范围。台面高 0.5。前段正对镜头；两翼从前段往后墙延伸。 */
export const BAR = {
  top: 0.5,
  front: { minX: -2.2, maxX: 2.2, minZ: 0.4, maxZ: 1.1 },
  left: { minX: -2.2, maxX: -1.5, minZ: -2.6, maxZ: 0.4 },
  right: { minX: 1.5, maxX: 2.2, minZ: -2.6, maxZ: 0.4 },
};
/** 后墙下的操作台，上面是顶到天花板的置物架，都在吧台里面。 */
export const WORKTOP = { minX: -2.6, maxX: 2.6, minZ: ROOM.minZ, maxZ: -3.3 };
/** 左翼末端和操作台之间的腰门；右翼末端用一段矮柜封上。 */
export const GATE = { minX: -2.2, maxX: -1.5, minZ: WORKTOP.maxZ, maxZ: BAR.left.minZ };
export const CABINET = { minX: 1.5, maxX: 2.2, minZ: WORKTOP.maxZ, maxZ: BAR.right.minZ };

/**
 * 两翼外侧的四张圆凳，序号和 CafeState 里的座位号一致：0、1 在左翼，2、3 在右翼，各自从里往外。
 * heading 是坐下后的朝向，面向吧台。
 */
export const STOOLS = [
  { x: -2.8, z: -1.75, heading: Math.PI / 2 },
  { x: -2.8, z: -0.45, heading: Math.PI / 2 },
  { x: 2.8, z: -1.75, heading: -Math.PI / 2 },
  { x: 2.8, z: -0.45, heading: -Math.PI / 2 },
];
export const STOOL_TOP = 0.32;
export const STOOL_RADIUS = 0.26;
/** 坐在圆凳上时角色脚底的高度：裙摆下沿正好落在凳面上。 */
export const SEATED_Y = STOOL_TOP - 0.24;
/** 圆凳旁多近算是能坐下。 */
export const SEAT_REACH = 0.6;

/**
 * 一杯饮品放在某张圆凳前的台面上：靠吧台内侧，和圆凳前后对齐。
 * 放在内侧是因为她站在吧台里推杯子，手够不到外沿。
 */
export function cupSpot(seat: number) {
  const { x, z } = STOOLS[seat];
  return { x: x < 0 ? BAR.left.maxX - 0.22 : BAR.right.minX + 0.22, z };
}

/** 她在吧台内的站位。heading 是朝向的弧度，0 朝向镜头（+z），π/2 朝右（+x）。 */
export type Spot = { x: number; z: number; heading: number };
/** 平时站在前段后面，正面朝镜头。 */
export const BARISTA_HOME: Spot = { x: 0, z: 0, heading: 0 };
/** 后墙操作台上的咖啡机前，背对镜头。 */
export const BARISTA_MACHINE: Spot = { x: 0, z: -2.95, heading: Math.PI };
/**
 * 给某张圆凳上饮品时的站位：面朝那一翼，再往镜头偏一点，画面里是斜侧面、看得到表情。
 * 位置从杯子要停下的地方倒推：上饮品动作结束时杯子正好在 cupSpot 上。
 */
export function baristaSeatSpot(seat: number): Spot {
  const heading = STOOLS[seat].x < 0 ? -Math.PI / 2 + 0.45 : Math.PI / 2 - 0.45;
  const cup = cupSpot(seat);
  const [x, , z] = servedCupPosition;
  return {
    x: cup.x - (x * Math.cos(heading) + z * Math.sin(heading)),
    z: cup.z - (-x * Math.sin(heading) + z * Math.cos(heading)),
    heading,
  };
}

/** 留言板立在左前方，面朝镜头；站在它前面能看留言。 */
export const BOARD = { minX: -5.4, maxX: -4.0, z: 2.3 };
export const BOARD_SPOT = { x: -4.7, z: 2.85 };
export const BOARD_REACH = 0.7;

/** 吧台前的地毯。 */
export const RUG = { minX: -2.8, maxX: 2.8, minZ: 1.6, maxZ: 2.75 };

/** 顾客进店时出现的位置：正前方店门口的地垫上，面朝店里。 */
export const ENTRANCE: Spot = { x: 0, z: 3.2, heading: Math.PI };

/** 顾客能走动的范围，以及走不进去的地方（吧台和吧台内、家具）。角色按半径 0.25 的圆参与碰撞。 */
export const WALKABLE = { minX: -5.75, maxX: 5.75, minZ: -3.75, maxZ: 3.4 };
export const CUSTOMER_RADIUS = 0.25;
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
export const OBSTACLES: Rect[] = [
  {
    minX: BAR.left.minX - 0.05,
    maxX: BAR.right.maxX + 0.05,
    minZ: ROOM.minZ,
    maxZ: BAR.front.maxZ + 0.05,
  },
  { minX: WORKTOP.minX, maxX: WORKTOP.maxX, minZ: ROOM.minZ, maxZ: WORKTOP.maxZ },
  // 纸窗下的长椅、黑板下的矮书架、后墙右角的绿植。
  { minX: ROOM.minX, maxX: -2.9, minZ: ROOM.minZ, maxZ: -3.25 },
  { minX: 2.9, maxX: 4.4, minZ: ROOM.minZ, maxZ: -3.45 },
  { minX: 4.9, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: -3.0 },
  // 左右的小桌。
  { minX: -4.8, maxX: -3.8, minZ: -1.8, maxZ: -0.8 },
  { minX: 3.8, maxX: 4.8, minZ: -1.6, maxZ: -0.6 },
  // 左前方的留言板，右前方的陈列台和绿植。
  { minX: BOARD.minX, maxX: BOARD.maxX, minZ: BOARD.z - 0.12, maxZ: BOARD.z + 0.12 },
  { minX: 3.5, maxX: 5.1, minZ: 1.7, maxZ: 2.4 },
  { minX: 4.9, maxX: ROOM.maxX, minZ: 2.6, maxZ: ROOM.maxZ },
];
