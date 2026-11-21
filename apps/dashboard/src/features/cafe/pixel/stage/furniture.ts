import type { Group } from "three";
import { BOARD, ENTRANCE, ROOM, STOOL_RADIUS, STOOL_TOP, STOOLS } from "./layout";
import type { SceneMaterials } from "./pixel-material";
import { palette } from "./room";
import type { Shapes } from "./shapes";

/**
 * 摆放家具：两翼外侧的圆凳、纸窗下的长椅、左右两张小桌、黑板下的矮书架、角落的绿植、
 * 右前方的陈列台、左前方的留言板、门口的地垫、营业牌和伞架。每件家具底下都有接地阴影。
 */
export function buildFurniture(
  group: Group,
  { box, cylinder, blob, floorPatch }: Shapes,
  { material, contactShadow }: SceneMaterials,
) {
  const wood = material(palette.wood);
  const woodDark = material(palette.woodDark);
  const honey = material(palette.honey);
  /** 圆形家具底下的接地阴影。 */
  const roundShadow = (x: number, z: number, radius: number) =>
    cylinder(group, contactShadow, x, z, [0.003, 0.005], radius);

  // 圆凳：一圈底盘、一根立柱、木凳面。
  for (const { x, z } of STOOLS) {
    roundShadow(x, z, STOOL_RADIUS + 0.06);
    cylinder(group, woodDark, x, z, [0, 0.05], 0.2);
    cylinder(group, woodDark, x, z, [0.05, STOOL_TOP - 0.06], 0.06);
    cylinder(group, material("#8a5536"), x, z, [STOOL_TOP - 0.06, STOOL_TOP], STOOL_RADIUS);
  }

  // 纸窗下的长椅：木座板、三块座布团，靠墙一排亚麻靠垫。
  floorPatch(group, contactShadow, [ROOM.minX, -2.75], [ROOM.minZ, -3.15], 0.005);
  box(group, wood, [ROOM.minX + 0.05, -2.9], [0, 0.3], [ROOM.minZ, -3.3]);
  box(group, honey, [ROOM.minX + 0.05, -2.9], [0.3, 0.34], [ROOM.minZ, -3.27]);
  for (const [x, color] of [
    [-5.3, palette.matcha],
    [-4.4, palette.azuki],
    [-3.5, palette.matcha],
  ] as const) {
    box(group, material(color), [x - 0.34, x + 0.34], [0.34, 0.42], [-3.86, -3.34]);
    box(group, material(palette.cream), [x - 0.3, x + 0.3], [0.42, 0.85], [ROOM.minZ, -3.82]);
  }

  // 左右两张单柱小桌，桌上一套咖啡杯碟，配一支蜡烛或一轮插。
  for (const [x, z, accent] of [
    [-4.3, -1.3, "candle"],
    [4.3, -1.1, "flower"],
  ] as const) {
    roundShadow(x, z, 0.55);
    cylinder(group, woodDark, x, z, [0, 0.05], 0.26);
    cylinder(group, woodDark, x, z, [0.05, 0.44], 0.07);
    cylinder(group, honey, x, z, [0.44, 0.5], 0.5);
    cylinder(group, material(palette.porcelain), x - 0.15, z + 0.1, [0.5, 0.52], 0.14);
    cylinder(group, material(palette.porcelain), x - 0.15, z + 0.1, [0.52, 0.66], 0.09);
    cylinder(group, material("#6a3f28"), x - 0.15, z + 0.1, [0.66, 0.665], 0.075);
    if (accent === "candle") {
      cylinder(group, material(palette.cream), x + 0.2, z - 0.1, [0.5, 0.66], 0.05);
      box(
        group,
        material(palette.flame, { emissive: true }),
        [x + 0.18, x + 0.22],
        [0.66, 0.74],
        [z - 0.12, z - 0.08],
      );
    } else {
      cylinder(group, material(palette.sage), x + 0.2, z - 0.1, [0.5, 0.7], 0.06);
      blob(group, material(palette.purple), [x + 0.2, 0.8, z - 0.1], [0.08, 0.07, 0.08]);
      blob(group, material(palette.leaf), [x + 0.27, 0.74, z - 0.1], [0.05, 0.03, 0.04]);
    }
  }

  // 黑板下的矮书架：两层书，顶上一盆小绿植和陶瓶。
  floorPatch(group, contactShadow, [2.8, 4.5], [ROOM.minZ, -3.35], 0.005);
  box(group, wood, [2.9, 4.4], [0, 0.95], [ROOM.minZ, -3.5]);
  const bookColors = [
    palette.azuki,
    palette.cream,
    palette.sage,
    palette.kraft,
    palette.matcha,
    palette.terracotta,
  ];
  for (const [shelf, y] of [0.08, 0.5].entries()) {
    for (let i = 0; i < 8; i++) {
      const x = 3.0 + i * 0.17;
      const height = 0.26 + ((i + shelf) % 3) * 0.04;
      box(
        group,
        material(bookColors[(i + shelf * 2) % bookColors.length]),
        [x, x + 0.13],
        [y, y + height],
        [-3.95, -3.55],
      );
    }
  }
  cylinder(group, material(palette.terracotta), 3.2, -3.75, [0.95, 1.1], 0.1);
  blob(group, material(palette.leaf), [3.2, 1.22, -3.75], [0.17, 0.14, 0.13]);
  cylinder(group, material(palette.sage), 4.1, -3.75, [0.95, 1.25], 0.08);

  // 后墙右角和右前角的大绿植。
  for (const [x, z] of [
    [5.35, -3.45],
    [5.35, 3.05],
  ] as const) {
    roundShadow(x, z, 0.4);
    cylinder(group, material(palette.terracotta), x, z, [0, 0.45], 0.28);
    cylinder(group, material("#8a4a34"), x, z, [0.4, 0.46], 0.3);
    blob(group, material(palette.leaf), [x, 0.85, z], [0.4, 0.45, 0.36]);
    blob(group, material(palette.leafLight), [x - 0.14, 1.2, z + 0.08], [0.26, 0.28, 0.24]);
  }

  // 右前方的杂货陈列台：出售的咖啡豆袋、茶筒和一颗苔玉。
  floorPatch(group, contactShadow, [3.4, 5.2], [1.7, 2.5], 0.005);
  box(group, wood, [3.5, 5.1], [0, 0.46], [1.75, 2.35]);
  box(group, honey, [3.46, 5.14], [0.46, 0.5], [1.71, 2.39]);
  for (const x of [3.65, 3.95, 4.25]) {
    box(group, material(palette.kraft), [x, x + 0.22], [0.5, 0.82], [1.88, 2.08]);
    box(group, material(palette.woodDark), [x + 0.06, x + 0.16], [0.62, 0.7], [2.08, 2.09]);
  }
  cylinder(group, material(palette.matcha), 4.75, 1.95, [0.5, 0.68], 0.08);
  cylinder(group, material(palette.azuki), 4.9, 2.18, [0.5, 0.74], 0.08);
  blob(group, material(palette.leaf), [4.6, 0.6, 2.2], [0.1, 0.1, 0.1]);

  // 左前方的立式留言板：两条腿撑起软木板，上面钉着几张便签。
  floorPatch(
    group,
    contactShadow,
    [BOARD.minX, BOARD.maxX],
    [BOARD.z - 0.12, BOARD.z + 0.16],
    0.005,
  );
  for (const x of [BOARD.minX + 0.12, BOARD.maxX - 0.12]) {
    box(group, woodDark, [x - 0.05, x + 0.05], [0, 1.65], [BOARD.z - 0.05, BOARD.z + 0.05]);
  }
  box(group, wood, [BOARD.minX, BOARD.maxX], [0.7, 1.65], [BOARD.z - 0.03, BOARD.z + 0.05]);
  box(
    group,
    material("#c49a63"),
    [BOARD.minX + 0.08, BOARD.maxX - 0.08],
    [0.78, 1.57],
    [BOARD.z + 0.05, BOARD.z + 0.06],
  );
  for (const [dx, y, color] of [
    [0.3, 1.35, "#fbf3dc"],
    [0.7, 1.4, "#e7efd9"],
    [1.08, 1.25, "#f6e0d6"],
    [0.45, 0.98, "#f6e0d6"],
    [0.9, 0.98, "#fbf3dc"],
  ] as const) {
    const x = BOARD.minX + dx;
    box(
      group,
      material(color),
      [x - 0.13, x + 0.13],
      [y - 0.13, y + 0.13],
      [BOARD.z + 0.06, BOARD.z + 0.07],
    );
    box(
      group,
      material(palette.azuki),
      [x - 0.02, x + 0.02],
      [y + 0.08, y + 0.12],
      [BOARD.z + 0.07, BOARD.z + 0.08],
    );
  }

  // 店门口：地垫、右边立式的"営業中"小木牌、左边的伞架。
  floorPatch(
    group,
    material("#8f6a45", { stripe: { axis: "x", period: 0.12 } }),
    [ENTRANCE.x - 0.8, ENTRANCE.x + 0.8],
    [2.95, 3.55],
    0.006,
  );
  box(group, woodDark, [1.37, 1.43], [0, 0.55], [3.17, 3.23]);
  box(group, honey, [1.1, 1.7], [0.55, 0.95], [3.2, 3.25]);
  box(group, woodDark, [1.2, 1.6], [0.7, 0.8], [3.25, 3.26]);
  roundShadow(-1.4, 3.2, 0.17);
  cylinder(group, material(palette.sage), -1.4, 3.2, [0, 0.45], 0.13);
  box(group, woodDark, [-1.45, -1.4], [0.45, 0.75], [3.15, 3.2]);
  box(group, material(palette.azuki), [-1.36, -1.31], [0.45, 0.7], [3.22, 3.27]);
}
