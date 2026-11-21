import { Group } from "three";
import { BAR, cupSpot, ROOM, STOOLS, WORKTOP } from "./layout";
import type { SceneMaterials } from "./pixel-material";
import { palette } from "./room";
import type { Shapes } from "./shapes";

/**
 * 摆放不会变的小道具：置物架上的器物、操作台上的咖啡器具、吧台上的摆设。
 * 小道具比真实尺寸略大，少而大，每件都有足够的像素画出形状。
 */
export function buildProps(
  group: Group,
  { box, cylinder, blob }: Shapes,
  { material }: SceneMaterials,
) {
  const top = BAR.top;
  const shelfZ = ROOM.minZ + 0.16;

  // 置物架四层：陶杯、汤吞杯、茶筒、咖啡豆玻璃罐、书、小绿植，按固定的顺序轮流摆，避开竖板。
  const shelfItems = [
    (x: number, y: number) => {
      cylinder(group, material(palette.porcelain), x, shelfZ, [y, y + 0.16], 0.09);
      box(
        group,
        material(palette.porcelain),
        [x + 0.08, x + 0.13],
        [y + 0.04, y + 0.12],
        [shelfZ - 0.02, shelfZ + 0.02],
      );
    },
    (x: number, y: number) =>
      cylinder(group, material(palette.matcha), x, shelfZ, [y, y + 0.14], 0.09),
    (x: number, y: number) => {
      cylinder(group, material(palette.azuki), x, shelfZ, [y, y + 0.26], 0.08);
      cylinder(group, material(palette.woodDark), x, shelfZ, [y + 0.26, y + 0.3], 0.085);
    },
    (x: number, y: number) => {
      cylinder(group, material("#e9e4dc"), x, shelfZ, [y, y + 0.3], 0.1);
      cylinder(group, material("#5b3a25"), x, shelfZ, [y, y + 0.18], 0.095);
      cylinder(group, material(palette.woodDark), x, shelfZ, [y + 0.3, y + 0.34], 0.07);
    },
    (x: number, y: number) => {
      for (const [dx, color] of [
        [-0.07, palette.terracotta],
        [0.0, palette.cream],
        [0.07, palette.sage],
      ] as const) {
        box(
          group,
          material(color),
          [x + dx - 0.03, x + dx + 0.03],
          [y, y + 0.32],
          [shelfZ - 0.12, shelfZ + 0.1],
        );
      }
    },
    (x: number, y: number) => {
      cylinder(group, material(palette.terracotta), x, shelfZ, [y, y + 0.12], 0.08);
      blob(group, material(palette.leaf), [x, y + 0.22, shelfZ], [0.14, 0.12, 0.1]);
    },
  ];
  let item = 0;
  for (const y of [1.35, 1.85, 2.35, 2.85]) {
    for (let x = WORKTOP.minX + 0.22; x < WORKTOP.maxX - 0.15; x += 0.34) {
      if ([-0.85, 0.85].every((upright) => Math.abs(x - upright) > 0.16)) {
        shelfItems[item % shelfItems.length](x, y);
        item += 1;
      }
    }
    item += 2;
  }

  // 操作台正中：拉杆式意式咖啡机，两个冲煮头下各一只杯子，前面一条接水盘。
  const front = WORKTOP.maxZ;
  box(
    group,
    material("#d8c7a7"),
    [-0.55, 0.55],
    [top, top + 0.6],
    [ROOM.minZ + 0.03, front - 0.08],
  );
  box(
    group,
    material("#8a7a66"),
    [-0.55, 0.55],
    [top + 0.6, top + 0.66],
    [ROOM.minZ + 0.03, front - 0.08],
  );
  box(group, material(palette.iron), [-0.5, 0.5], [top, top + 0.05], [front - 0.08, front]);
  for (const x of [-0.22, 0.22]) {
    box(
      group,
      material(palette.iron),
      [x - 0.09, x + 0.09],
      [top + 0.26, top + 0.36],
      [front - 0.12, front - 0.02],
    );
    box(
      group,
      material(palette.iron),
      [x - 0.015, x + 0.015],
      [top + 0.36, top + 0.5],
      [front - 0.06, front - 0.03],
    );
    cylinder(group, material(palette.porcelain), x, front - 0.06, [top + 0.05, top + 0.16], 0.07);
  }
  // 左边一摞汤吞杯、奶缸和两袋咖啡豆；右边磨豆机、细嘴壶、铁壶。
  for (let i = 0; i < 3; i++) {
    cylinder(
      group,
      material(palette.sage),
      -1.3,
      ROOM.minZ + 0.3,
      [top + i * 0.09, top + i * 0.09 + 0.08],
      0.1,
    );
  }
  cylinder(group, material("#c9c4bb"), -0.95, ROOM.minZ + 0.35, [top, top + 0.18], 0.08);
  for (const x of [-1.85, -2.25]) {
    box(
      group,
      material(palette.kraft),
      [x - 0.15, x + 0.15],
      [top, top + 0.38],
      [ROOM.minZ + 0.15, ROOM.minZ + 0.42],
    );
    box(
      group,
      material(palette.woodDark),
      [x - 0.08, x + 0.08],
      [top + 0.18, top + 0.26],
      [ROOM.minZ + 0.42, ROOM.minZ + 0.43],
    );
  }
  box(
    group,
    material(palette.iron),
    [1.15, 1.45],
    [top, top + 0.4],
    [ROOM.minZ + 0.12, ROOM.minZ + 0.42],
  );
  cylinder(group, material("#6b4a33"), 1.3, ROOM.minZ + 0.27, [top + 0.4, top + 0.62], 0.15);
  blob(group, material("#a9a49b"), [1.85, top + 0.13, ROOM.minZ + 0.3], [0.14, 0.13, 0.13]);
  box(
    group,
    material("#a9a49b"),
    [1.97, 2.12],
    [top + 0.14, top + 0.18],
    [ROOM.minZ + 0.28, ROOM.minZ + 0.32],
  );
  blob(group, material(palette.iron), [2.3, top + 0.15, ROOM.minZ + 0.3], [0.17, 0.15, 0.16]);
  cylinder(group, material(palette.iron), 2.3, ROOM.minZ + 0.3, [top + 0.28, top + 0.33], 0.04);

  // 两翼：两张圆凳之间各一支蜡烛；左翼里端一小瓶紫色花，右翼里端一只虹吸壶。
  const wingX = (wing: { minX: number; maxX: number }) => (wing.minX + wing.maxX) / 2;
  const betweenZ = (STOOLS[0].z + STOOLS[1].z) / 2;
  const innerZ = BAR.left.minZ + 0.2;
  for (const wing of [BAR.left, BAR.right]) {
    cylinder(group, material(palette.cream), wingX(wing), betweenZ, [top, top + 0.16], 0.05);
    box(
      group,
      material(palette.flame, { emissive: true }),
      [wingX(wing) - 0.02, wingX(wing) + 0.02],
      [top + 0.16, top + 0.24],
      [betweenZ - 0.02, betweenZ + 0.02],
    );
  }
  cylinder(group, material(palette.sage), wingX(BAR.left), innerZ, [top, top + 0.2], 0.06);
  blob(group, material(palette.purple), [wingX(BAR.left), top + 0.3, innerZ], [0.09, 0.08, 0.09]);
  cylinder(group, material(palette.iron), wingX(BAR.right), innerZ, [top, top + 0.06], 0.13);
  cylinder(group, material("#7a4a32"), wingX(BAR.right), innerZ, [top + 0.06, top + 0.18], 0.09);
  blob(group, material("#e8e2d6"), [wingX(BAR.right), top + 0.3, innerZ], [0.11, 0.14, 0.11]);

  // 前段：左端一块草莓蛋糕和一篮面包，右端收银机和小台灯；正中留空，不挡她。
  const frontZ = (BAR.front.minZ + BAR.front.maxZ) / 2;
  cylinder(group, material(palette.porcelain), -1.65, frontZ, [top, top + 0.03], 0.24);
  box(
    group,
    material("#f2d7c3"),
    [-1.79, -1.51],
    [top + 0.03, top + 0.2],
    [frontZ - 0.1, frontZ + 0.1],
  );
  box(
    group,
    material(palette.porcelain),
    [-1.79, -1.51],
    [top + 0.1, top + 0.13],
    [frontZ - 0.1, frontZ + 0.1],
  );
  blob(group, material("#d9534f"), [-1.65, top + 0.25, frontZ], [0.05, 0.05, 0.05]);
  box(
    group,
    material(palette.kraft),
    [-1.2, -0.7],
    [top, top + 0.1],
    [frontZ - 0.17, frontZ + 0.17],
  );
  for (const [x, dz] of [
    [-1.07, -0.06],
    [-0.88, 0.05],
    [-0.98, 0.1],
  ] as const) {
    blob(group, material("#d79a5b"), [x, top + 0.13, frontZ + dz], [0.09, 0.06, 0.07]);
  }
  box(group, material("#7d6a55"), [0.8, 1.4], [top, top + 0.28], [frontZ - 0.2, frontZ + 0.15]);
  box(
    group,
    material("#4e4036"),
    [0.84, 1.36],
    [top + 0.28, top + 0.38],
    [frontZ - 0.18, frontZ - 0.02],
  );
  box(
    group,
    material(palette.cream),
    [0.9, 1.3],
    [top + 0.18, top + 0.24],
    [frontZ + 0.15, frontZ + 0.16],
  );
  cylinder(group, material(palette.woodDark), 1.85, frontZ, [top, top + 0.4], 0.025);
  cylinder(
    group,
    material(palette.lampShade, { emissive: true }),
    1.85,
    frontZ,
    [top + 0.36, top + 0.5],
    0.14,
  );
}

/**
 * 吧台上按座位摆的饮品杯：杯子归座位，每张圆凳前最多一杯。
 * 咖啡液面的高度随剩余量下降，喝空后只剩空杯。
 */
export function createSeatCups(group: Group, { cylinder }: Shapes, { material }: SceneMaterials) {
  const cups = STOOLS.map((_, seat) => {
    const cup = new Group();
    const { x, z } = cupSpot(seat);
    cup.position.set(x, BAR.top, z);
    cylinder(cup, material(palette.porcelain), 0, 0, [0, 0.02], 0.15);
    cylinder(cup, material(palette.porcelain), 0, 0, [0.02, 0.18], 0.1);
    const coffee = cylinder(cup, material("#6a3f28"), 0, 0, [0, 0.005], 0.085);
    cup.visible = false;
    group.add(cup);
    return { cup, coffee };
  });
  return {
    /** remaining 为 null 的座位前没有杯子。 */
    show(remainingBySeat: (number | null)[]) {
      for (const [seat, { cup, coffee }] of cups.entries()) {
        const remaining = remainingBySeat[seat];
        cup.visible = remaining !== null;
        coffee.visible = remaining !== null && remaining > 0;
        coffee.position.y = 0.04 + 0.14 * (remaining ?? 0);
      }
    },
  };
}
