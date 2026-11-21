import { type Group, Vector3 } from "three";
import { BAR, CABINET, cupSpot, GATE, ROOM, RUG, STOOLS, WORKTOP } from "./layout";
import type { PoolLight, Rgb, SceneMaterials } from "./pixel-material";
import type { Shapes } from "./shapes";

/**
 * 店内的颜色。家具木头偏深，地板比家具亮两档，台面是更亮的蜂蜜色，墙面奶油米色：
 * 深浅拉开，物件的轮廓在像素画面里才清楚。
 */
export const palette = {
  floor: "#a87650",
  wood: "#5e3a27",
  woodDark: "#3f2619",
  honey: "#d9a464",
  wall: "#efdcb8",
  windowPaper: "#dde0f2",
  lampShade: "#fff1cf",
  flame: "#ffd27a",
  chalkboard: "#2f3a33",
  chalk: "#e8e2d2",
  matcha: "#8fa66b",
  sage: "#7f9478",
  azuki: "#a8574a",
  terracotta: "#c0704f",
  cream: "#ead8b4",
  kraft: "#c9a46b",
  porcelain: "#f4eee4",
  purple: "#9b7cc8",
  leaf: "#5f8a4f",
  leafLight: "#7fa860",
  iron: "#3d3533",
};

const warm: Rgb = [1.0, 0.72, 0.42];
const dimWarm: Rgb = [0.8, 0.58, 0.34];

/** 环境光：店里偏暗，但物件的底色要看得清。 */
export const CAFE_AMBIENT: Rgb = [0.66, 0.56, 0.52];

/**
 * 店里的灯，只照朝上的面。两翼每张圆凳前一圈、前段一圈，最亮的区域是吧台，视线集中到她身上；
 * 其余是收银台台灯、两张小桌的吊灯、置物架灯带、黑板壁灯、门口和陈列台的光。纸窗透进一点偏冷的暮色。
 */
export const CAFE_LIGHTS: PoolLight[] = [
  ...STOOLS.map(({ z }, seat) => ({
    position: new Vector3(cupSpot(seat).x, 1.3, z),
    radius: 1.2,
    color: dimWarm,
  })),
  { position: new Vector3(0, 1.3, 0.75), radius: 1.6, color: dimWarm },
  { position: new Vector3(1.85, 0.95, 0.75), radius: 0.9, color: warm },
  { position: new Vector3(-4.3, 1.3, -1.3), radius: 1.3, color: warm },
  { position: new Vector3(4.3, 1.3, -1.1), radius: 1.3, color: warm },
  { position: new Vector3(-1.3, 1.9, -3.6), radius: 1.3, color: [0.5, 0.36, 0.21] },
  { position: new Vector3(1.3, 1.9, -3.6), radius: 1.3, color: [0.5, 0.36, 0.21] },
  { position: new Vector3(3.65, 2.5, -3.8), radius: 0.9, color: [0.72, 0.52, 0.3] },
  { position: new Vector3(-4.3, 1.8, -3.6), radius: 1.6, color: [0.3, 0.34, 0.52] },
  { position: new Vector3(0, 1.3, 3.0), radius: 2.0, color: [0.42, 0.3, 0.18] },
  { position: new Vector3(4.3, 1.2, 2.0), radius: 1.2, color: [0.5, 0.36, 0.21] },
];

/** 搭建店面结构：地板、地毯、三面墙、纸窗、黑板、挂画、コ字吧台和腰门、操作台和置物架、吊灯、接地阴影。 */
export function buildRoom(
  group: Group,
  { box, cylinder, floorPatch }: Shapes,
  { material, contactShadow }: SceneMaterials,
) {
  const wood = material(palette.wood);
  const woodDark = material(palette.woodDark);
  const honey = material(palette.honey);
  const backWall = ROOM.minZ;

  // 地板沿 z 方向铺木条；前沿剖开处露出地板的厚度。墙脚一道接地阴影。
  box(
    group,
    material(palette.floor, { stripe: { axis: "x", period: 0.4 } }),
    [ROOM.minX, ROOM.maxX],
    [-0.14, 0],
    [ROOM.minZ, ROOM.maxZ],
  );
  floorPatch(group, contactShadow, [ROOM.minX, ROOM.maxX], [backWall, backWall + 0.25], 0.004);

  // 吧台前的地毯：小豆红的边，中间一圈奶油色条纹，再里面一块小豆红。
  floorPatch(group, material(palette.azuki), [RUG.minX, RUG.maxX], [RUG.minZ, RUG.maxZ], 0.006);
  floorPatch(
    group,
    material(palette.cream, { stripe: { axis: "x", period: 0.24 } }),
    [RUG.minX + 0.12, RUG.maxX - 0.12],
    [RUG.minZ + 0.12, RUG.maxZ - 0.12],
    0.008,
  );
  floorPatch(
    group,
    material(palette.azuki),
    [RUG.minX + 0.28, RUG.maxX - 0.28],
    [RUG.minZ + 0.28, RUG.maxZ - 0.28],
    0.01,
  );

  // 后墙：下半截竖条护墙板、压条、上半截奶油色墙面。
  box(
    group,
    material(palette.wood, { stripe: { axis: "x", period: 0.2 } }),
    [ROOM.minX, ROOM.maxX],
    [0, 1.0],
    [backWall - 0.1, backWall],
  );
  box(group, woodDark, [ROOM.minX, ROOM.maxX], [1.0, 1.08], [backWall - 0.12, backWall + 0.03]);
  box(
    group,
    material(palette.wall),
    [ROOM.minX, ROOM.maxX],
    [1.08, ROOM.wallHeight],
    [backWall - 0.1, backWall],
  );
  // 左右墙从正前方看只露出顶面和剖开的端面，做成一圈深色木框。
  box(
    group,
    woodDark,
    [ROOM.minX - 0.24, ROOM.minX],
    [-0.14, ROOM.wallHeight],
    [backWall - 0.1, ROOM.maxZ],
  );
  box(
    group,
    woodDark,
    [ROOM.maxX, ROOM.maxX + 0.24],
    [-0.14, ROOM.wallHeight],
    [backWall - 0.1, ROOM.maxZ],
  );

  // 后墙左边的障子纸窗：深色木框，纸面透出偏冷的暮色，木格压在纸上。
  box(group, woodDark, [-5.55, -3.05], [1.2, 2.65], [backWall, backWall + 0.05]);
  box(
    group,
    material(palette.windowPaper, { emissive: true }),
    [-5.45, -3.15],
    [1.3, 2.55],
    [backWall + 0.05, backWall + 0.06],
  );
  for (const x of [-4.875, -4.3, -3.725]) {
    box(group, woodDark, [x - 0.03, x + 0.03], [1.3, 2.55], [backWall + 0.06, backWall + 0.09]);
  }
  for (const y of [1.72, 2.13]) {
    box(group, woodDark, [-5.45, -3.15], [y - 0.03, y + 0.03], [backWall + 0.06, backWall + 0.09]);
  }

  // 后墙右边的黑板菜单和上方的小壁灯，几行粉笔字；再往右一幅小挂画。
  box(group, wood, [2.95, 4.35], [1.35, 2.5], [backWall, backWall + 0.05]);
  box(
    group,
    material(palette.chalkboard),
    [3.03, 4.27],
    [1.43, 2.42],
    [backWall + 0.05, backWall + 0.06],
  );
  const chalk = material(palette.chalk, { emissive: true });
  box(group, chalk, [3.2, 3.9], [2.22, 2.28], [backWall + 0.06, backWall + 0.07]);
  for (const [x1, y] of [
    [3.95, 2.02],
    [3.75, 1.88],
    [4.05, 1.74],
    [3.85, 1.6],
  ] as const) {
    box(group, chalk, [3.15, x1], [y - 0.025, y + 0.025], [backWall + 0.06, backWall + 0.07]);
  }
  box(
    group,
    material(palette.lampShade, { emissive: true }),
    [3.5, 3.8],
    [2.56, 2.7],
    [backWall + 0.03, backWall + 0.18],
  );
  box(group, woodDark, [4.8, 5.7], [1.55, 2.4], [backWall, backWall + 0.04]);
  box(group, material("#b9c79a"), [4.88, 5.62], [1.63, 2.32], [backWall + 0.04, backWall + 0.05]);
  box(group, material("#e8b98a"), [5.05, 5.45], [1.8, 2.12], [backWall + 0.05, backWall + 0.06]);

  // 吧台里后墙下的操作台，上面是顶到天花板的置物架，正中留给咖啡机。
  box(
    group,
    material(palette.wood, { stripe: { axis: "x", period: 0.18 } }),
    [WORKTOP.minX, WORKTOP.maxX],
    [0, 0.46],
    [backWall, WORKTOP.maxZ],
  );
  box(
    group,
    honey,
    [WORKTOP.minX - 0.03, WORKTOP.maxX + 0.03],
    [0.46, BAR.top],
    [backWall, WORKTOP.maxZ + 0.05],
  );
  for (const y of [1.35, 1.85, 2.35, 2.85]) {
    box(group, woodDark, [WORKTOP.minX, WORKTOP.maxX], [y - 0.05, y], [backWall, backWall + 0.32]);
  }
  for (const x of [WORKTOP.minX, -0.85, 0.85, WORKTOP.maxX]) {
    box(
      group,
      woodDark,
      [x - 0.05, x + 0.05],
      [BAR.top, ROOM.wallHeight],
      [backWall, backWall + 0.32],
    );
  }

  // コ字吧台：缩进的深色踢脚、密排竖条立面、蜂蜜色台面，底下一圈接地阴影。
  const slatsAlongX = material(palette.wood, { stripe: { axis: "x", period: 0.14 } });
  const slatsAlongZ = material(palette.wood, { stripe: { axis: "z", period: 0.14 } });
  for (const [part, slats] of [
    [BAR.front, slatsAlongX],
    [BAR.left, slatsAlongZ],
    [BAR.right, slatsAlongZ],
  ] as const) {
    floorPatch(
      group,
      contactShadow,
      [part.minX - 0.12, part.maxX + 0.12],
      [part.minZ - 0.06, part.maxZ + 0.14],
      0.004,
    );
    box(group, slats, [part.minX, part.maxX], [0.1, 0.46], [part.minZ, part.maxZ]);
    box(
      group,
      woodDark,
      [part.minX + 0.05, part.maxX - 0.05],
      [0, 0.1],
      [part.minZ + 0.05, part.maxZ - 0.05],
    );
    box(
      group,
      honey,
      [part.minX - 0.04, part.maxX + 0.04],
      [0.46, BAR.top],
      [part.minZ - 0.04, part.maxZ + 0.04],
    );
  }
  // 前段两角各立一根方柱。
  for (const x of [BAR.front.minX, BAR.front.maxX]) {
    box(
      group,
      woodDark,
      [x - 0.08, x + 0.08],
      [0, 0.54],
      [BAR.front.maxZ - 0.08, BAR.front.maxZ + 0.08],
    );
  }

  // 左翼末端的腰门：下半截密排木条，上半截疏朗的木栅，顶上台面同色的压顶。右翼末端是一段矮柜。
  box(
    group,
    material(palette.wood, { stripe: { axis: "z", period: 0.1 } }),
    [GATE.minX + 0.2, GATE.maxX - 0.2],
    [0, 0.26],
    [GATE.minZ, GATE.maxZ],
  );
  for (let z = GATE.minZ + 0.12; z < GATE.maxZ; z += 0.22) {
    box(group, wood, [GATE.minX + 0.25, GATE.maxX - 0.25], [0.26, 0.46], [z - 0.03, z + 0.03]);
  }
  box(group, honey, [GATE.minX + 0.12, GATE.maxX - 0.12], [0.46, BAR.top], [GATE.minZ, GATE.maxZ]);
  box(group, wood, [CABINET.minX, CABINET.maxX], [0, 0.46], [CABINET.minZ, CABINET.maxZ]);
  box(
    group,
    honey,
    [CABINET.minX - 0.03, CABINET.maxX + 0.03],
    [0.46, BAR.top],
    [CABINET.minZ, CABINET.maxZ],
  );

  // 两张小桌上方的吊灯：细吊线加乳白玻璃灯罩。
  const shade = material(palette.lampShade, { emissive: true });
  for (const [x, z] of [
    [-4.3, -1.3],
    [4.3, -1.1],
  ] as const) {
    box(group, woodDark, [x - 0.015, x + 0.015], [1.65, ROOM.wallHeight], [z - 0.015, z + 0.015]);
    cylinder(group, shade, x, z, [1.45, 1.65], 0.16);
  }
}
