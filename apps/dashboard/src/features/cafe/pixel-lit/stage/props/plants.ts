import type { Material, Object3D } from "three";
import { type PropKit, seeded } from "./prop-shapes";
import { addPot } from "./vessels";

/**
 * 植物：大盆绿植、小盆栽、垂下来的藤蔓、苔玉、倒挂干花。叶子是一片片有厚度感的薄片，
 * 按固定伪随机散开，任何角度看都是立体的一丛，不是贴图立牌。
 */

/**
 * 摆一片叶子：叶柄在 at，朝水平方向 heading（弧度，0 指向 +z）伸出去，抬起 lift（弧度，0 是水平，正数朝上）。
 * 叶片在自身的 xy 平面里、长度沿 +y：先绕 x 转把叶尖放平到 +z，再绕 y 转到 heading。
 */
function placeLeaf(
  kit: PropKit,
  parent: Object3D,
  material: Material,
  at: readonly [number, number, number],
  length: number,
  width: number,
  heading: number,
  lift: number,
) {
  const leaf = kit.mesh(parent, kit.leaf(length, width), material, {
    at,
    cast: true,
    receive: true,
  });
  leaf.rotation.set(Math.PI / 2 - lift, heading, 0, "YXZ");
}

/** 落地大绿植（龟背竹一类）：陶盆、十几根叶柄从盆中心斜伸出去，每根顶着一片大叶子，上层叶色浅。 */
export function addFloorPlant(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  scale: number,
  seed: number,
) {
  const s = scale;
  const potHeight = 0.34 * s;
  addPot(kit, parent, x, 0, z, 0.2 * s, potHeight, kit.palette.terracotta);
  const { leafDark, leafMid, leafLight, woodLight } = kit.palette;
  const count = 16;
  for (let i = 0; i < count; i++) {
    const heading = i * 2.39996 + seed;
    const rise = 0.25 + seeded(seed * 31 + i) * 0.75;
    const reach = (0.12 + seeded(seed * 17 + i) * 0.2) * s;
    const top = potHeight + (0.25 + rise * 0.7) * s;
    const end: [number, number, number] = [
      x + Math.sin(heading) * reach,
      top,
      z + Math.cos(heading) * reach,
    ];
    kit.rod(parent, woodLight, [x, potHeight, z], end, 0.008 * s);
    const material = rise > 0.7 ? leafLight : rise > 0.45 ? leafMid : leafDark;
    // 高处的叶子往上翘，低处的叶子垂向水平以下
    placeLeaf(kit, parent, material, end, 0.3 * s, 0.14 * s, heading, 0.5 - (1 - rise) * 0.6);
  }
}

/** 架子和桌上的小盆栽：小陶盆里一簇向上散开的叶子。 */
export function addSmallPlant(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  pot: Material,
  seed: number,
) {
  addPot(kit, parent, x, y, z, 0.07, 0.1, pot);
  for (let i = 0; i < 7; i++) {
    const heading = i * 2.39996 + seed;
    const material = i % 3 === 0 ? kit.palette.leafLight : kit.palette.leafMid;
    placeLeaf(
      kit,
      parent,
      material,
      [x, y + 0.09, z],
      0.1 + seeded(seed + i) * 0.05,
      0.045,
      heading,
      0.6 + seeded(seed * 3 + i) * 0.6,
    );
  }
}

/**
 * 垂吊藤蔓（绿萝一类）：放在架子边上的小盆，几条藤越过架沿往下垂，藤上交错长着小叶子。
 * outward 是架子朝店里的水平方向（单位向量 x, z）。
 */
export function addTrailingPlant(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  outward: readonly [number, number],
  seed: number,
) {
  addPot(kit, parent, x, y, z, 0.075, 0.1, kit.palette.porcelain);
  const [ox, oz] = outward;
  const sideX = -oz;
  const sideZ = ox;
  for (let vine = 0; vine < 3; vine++) {
    const spread = (vine - 1) * 0.07;
    const drop = 0.3 + seeded(seed + vine) * 0.35;
    const points: [number, number, number][] = [
      [x + sideX * spread * 0.3, y + 0.1, z + sideZ * spread * 0.3],
      [x + ox * 0.12 + sideX * spread, y + 0.06, z + oz * 0.12 + sideZ * spread],
      [x + ox * 0.17 + sideX * spread, y - drop * 0.5, z + oz * 0.17 + sideZ * spread],
      [x + ox * 0.15 + sideX * spread * 1.4, y - drop, z + oz * 0.15 + sideZ * spread * 1.4],
    ];
    kit.mesh(parent, kit.tube(points, 0.005), kit.palette.leafDark, { at: [0, 0, 0], cast: false });
    const steps = Math.round(drop / 0.07) + 2;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const segment = Math.min(Math.floor(t * 3), 2);
      const local = t * 3 - segment;
      const a = points[segment];
      const b = points[segment + 1];
      const at: [number, number, number] = [
        a[0] + (b[0] - a[0]) * local,
        a[1] + (b[1] - a[1]) * local,
        a[2] + (b[2] - a[2]) * local,
      ];
      const heading = Math.atan2(ox, oz) + (i % 2 === 0 ? 0.9 : -0.9);
      placeLeaf(
        kit,
        parent,
        i % 2 === 0 ? kit.palette.leafMid : kit.palette.leafLight,
        at,
        0.07,
        0.04,
        heading,
        -0.3,
      );
    }
  }
}

/** 苔玉：浅碟上一颗青苔球，顶上冒几片叶子。 */
export function addKokedama(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.07, 0],
      [0.1, 0.022],
      [0.092, 0.026],
      [0, 0.014],
    ]),
    kit.palette.porcelain,
    { at: [x, y, z] },
  );
  kit.blob(parent, kit.palette.moss, [x, y + 0.08, z], [0.075, 0.068, 0.075]);
  for (let i = 0; i < 5; i++) {
    placeLeaf(kit, parent, kit.palette.leafLight, [x, y + 0.14, z], 0.08, 0.035, i * 1.26, 0.9);
  }
}

/**
 * 倒挂的干花：一根麻绳挂在墙钉上，一束花茎朝下散开，茎端是一簇簇小花。
 * at 是墙钉的位置，outward 是离开墙面的方向。
 */
export function addDriedFlowers(
  kit: PropKit,
  parent: Object3D,
  at: readonly [number, number, number],
  outward: readonly [number, number],
  bloom: Material,
  seed: number,
) {
  const [x, y, z] = at;
  const [ox, oz] = outward;
  const tieX = x + ox * 0.05;
  const tieZ = z + oz * 0.05;
  kit.rod(parent, kit.palette.kraft, [x, y, z], [tieX, y - 0.06, tieZ], 0.006);
  kit.blob(parent, kit.palette.kraft, [tieX, y - 0.07, tieZ], [0.022, 0.03, 0.022]);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + seed;
    const fan = 0.03 + seeded(seed + i) * 0.04;
    const length = 0.28 + seeded(seed * 5 + i) * 0.12;
    const end: [number, number, number] = [
      tieX + Math.cos(angle) * fan + ox * 0.03,
      y - 0.07 - length,
      tieZ + Math.sin(angle) * fan + oz * 0.03,
    ];
    kit.rod(parent, kit.palette.sage, [tieX, y - 0.07, tieZ], end, 0.005);
    kit.blob(parent, i % 3 === 0 ? kit.palette.cream : bloom, end, [0.03, 0.026, 0.03]);
  }
}
