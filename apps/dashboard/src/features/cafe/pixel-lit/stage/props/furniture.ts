import type { Material, Object3D } from "three";
import { type PropKit, seeded } from "./prop-shapes";

/**
 * 家具：吧台凳、高凳、椅子、方桌、圆桌、长椅、扶手椅、书。按角色比例做矮（坐面约 0.25~0.32 米），
 * 有腿、有横撑、坐垫鼓起来、台面有包边，轮廓在像素化之后仍然分得清。
 */

/** 吧台凳：皮面圆坐垫、木圈、四条外撇的腿和一圈脚踏。 */
export function addBarStool(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  seatHeight: number,
) {
  const { leather, woodDark, wood, brass } = kit.palette;
  const h = seatHeight;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.17, 0],
      [0.19, 0.02],
      [0.19, 0.035],
      [0.16, 0.055],
      [0, 0.06],
    ]),
    leather,
    { at: [x, h - 0.04, z] },
  );
  kit.cylinder(parent, wood, x, z, [h - 0.07, h - 0.04], 0.15);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    kit.rod(
      parent,
      woodDark,
      [x + Math.cos(angle) * 0.09, h - 0.07, z + Math.sin(angle) * 0.09],
      [x + Math.cos(angle) * 0.16, 0, z + Math.sin(angle) * 0.16],
      0.018,
    );
  }
  kit.mesh(parent, kit.torus(0.135, 0.01), brass, {
    at: [x, h * 0.35, z],
    rotation: [Math.PI / 2, 0, 0],
  });
}

/** 窗边吧台的高凳：方坐面，四腿加横撑。 */
export function addHighStool(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  seatHeight: number,
) {
  const { leather, woodDark } = kit.palette;
  const h = seatHeight;
  kit.mesh(parent, kit.roundedBox(0.3, 0.05, 0.3, 0.02), leather, { at: [x, h - 0.025, z] });
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    kit.rod(
      parent,
      woodDark,
      [x + dx * 0.1, h - 0.05, z + dz * 0.1],
      [x + dx * 0.13, 0, z + dz * 0.13],
      0.016,
    );
  }
  kit.box(
    parent,
    woodDark,
    [x - 0.12, x + 0.12],
    [h * 0.35, h * 0.35 + 0.025],
    [z - 0.12, z - 0.1],
  );
  kit.box(
    parent,
    woodDark,
    [x - 0.12, x + 0.12],
    [h * 0.35, h * 0.35 + 0.025],
    [z + 0.1, z + 0.12],
  );
}

/**
 * 木椅：坐面加一块座布团，四条腿和横撑，靠背是两根立柱、一根顶梁和三根竖条。
 * facing 是坐着的人面朝的水平方向（弧度，0 朝 +z）。
 */
export function addChair(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  facing: number,
  cushion: Material,
) {
  const { wood, woodDark } = kit.palette;
  const seat = 0.24;
  const forward = (d: number, side: number, y: number): [number, number, number] => [
    x + Math.sin(facing) * d + Math.cos(facing) * side,
    y,
    z + Math.cos(facing) * d - Math.sin(facing) * side,
  ];
  const seatMesh = kit.mesh(parent, kit.roundedBox(0.36, 0.04, 0.34, 0.015), wood, {
    at: [x, seat - 0.02, z],
  });
  seatMesh.rotation.y = facing;
  const cushionMesh = kit.mesh(parent, kit.roundedBox(0.3, 0.035, 0.28, 0.016), cushion, {
    at: [x, seat + 0.016, z],
  });
  cushionMesh.rotation.y = facing;
  for (const d of [-0.14, 0.14]) {
    for (const side of [-0.15, 0.15]) {
      kit.rod(
        parent,
        woodDark,
        forward(d, side, seat - 0.04),
        forward(d * 1.08, side * 1.08, 0),
        0.016,
      );
    }
  }
  for (const side of [-0.15, 0.15]) {
    kit.rod(parent, woodDark, forward(-0.14, side, 0.08), forward(0.14, side, 0.08), 0.01);
  }
  // 靠背：在椅子后沿
  for (const side of [-0.15, 0.15]) {
    kit.rod(parent, wood, forward(-0.16, side, seat), forward(-0.19, side, seat + 0.36), 0.018);
  }
  const rail = kit.mesh(parent, kit.roundedBox(0.36, 0.06, 0.03, 0.012), wood, {
    at: forward(-0.19, 0, seat + 0.34),
  });
  rail.rotation.y = facing;
  for (const side of [-0.07, 0, 0.07]) {
    kit.rod(
      parent,
      woodDark,
      forward(-0.17, side, seat + 0.02),
      forward(-0.19, side, seat + 0.31),
      0.009,
    );
  }
}

/** 单柱方桌：台面包边，车削的立柱，十字脚。 */
export function addSquareTable(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  width: number,
  depth: number,
  top: number,
) {
  const { honey, wood, woodDark } = kit.palette;
  kit.mesh(parent, kit.roundedBox(width, 0.035, depth, 0.012), honey, { at: [x, top - 0.018, z] });
  kit.box(
    parent,
    wood,
    [x - width / 2 + 0.03, x + width / 2 - 0.03],
    [top - 0.07, top - 0.035],
    [z - depth / 2 + 0.03, z + depth / 2 - 0.03],
  );
  addTurnedPedestal(kit, parent, x, z, top - 0.07);
  for (const angle of [0, Math.PI / 2]) {
    const cross = kit.mesh(parent, kit.roundedBox(0.4, 0.035, 0.05, 0.012), woodDark, {
      at: [x, 0.018, z],
    });
    cross.rotation.y = angle;
  }
}

/** 单柱圆桌：圆台面带一圈包边，车削立柱，十字脚。 */
export function addRoundTable(
  kit: PropKit,
  parent: Object3D,
  x: number,
  z: number,
  radius: number,
  top: number,
) {
  const { honey, wood, woodDark } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe(
      [
        [0, 0],
        [radius - 0.02, 0],
        [radius, 0.012],
        [radius, 0.03],
        [radius - 0.012, 0.038],
        [0, 0.038],
      ],
      28,
    ),
    honey,
    { at: [x, top - 0.038, z] },
  );
  kit.cylinder(parent, wood, x, z, [top - 0.07, top - 0.038], radius * 0.7);
  addTurnedPedestal(kit, parent, x, z, top - 0.07);
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const cross = kit.mesh(parent, kit.roundedBox(0.44, 0.035, 0.05, 0.012), woodDark, {
      at: [x, 0.018, z],
    });
    cross.rotation.y = angle;
  }
}

/** 桌子的车削立柱：中间鼓、两头收。 */
function addTurnedPedestal(kit: PropKit, parent: Object3D, x: number, z: number, height: number) {
  kit.mesh(
    parent,
    kit.lathe([
      [0.05, 0],
      [0.03, 0.05],
      [0.025, height * 0.4],
      [0.04, height * 0.55],
      [0.025, height * 0.7],
      [0.03, height],
      [0, height],
    ]),
    kit.palette.woodDark,
    { at: [x, 0, z] },
  );
}

/**
 * 长椅：靠墙的木长椅，前面一块挡板，座面上一排座布团，靠墙一排亚麻靠垫。
 * 长椅沿 z 方向放在左墙边，范围 x0..x1（x0 贴墙）、z0..z1。
 */
export function addWallBench(
  kit: PropKit,
  parent: Object3D,
  [x0, x1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  cushions: readonly Material[],
) {
  const { wood, woodDark, honey, linen, cream } = kit.palette;
  const seat = 0.22;
  kit.box(parent, wood, [x0, x1 - 0.04], [0.04, seat - 0.035], [z0, z1]);
  kit.box(parent, woodDark, [x1 - 0.05, x1 - 0.02], [0.02, seat - 0.035], [z0, z1]);
  kit.box(parent, woodDark, [x0, x1 - 0.06], [0, 0.04], [z0 + 0.02, z1 - 0.02]);
  kit.mesh(parent, kit.roundedBox(x1 - x0, 0.035, z1 - z0, 0.012), honey, {
    at: [(x0 + x1) / 2, seat - 0.018, (z0 + z1) / 2],
  });
  const count = cushions.length;
  const span = (z1 - z0) / count;
  for (const [i, material] of cushions.entries()) {
    const zc = z0 + span * (i + 0.5);
    kit.mesh(parent, kit.roundedBox(x1 - x0 - 0.14, 0.05, span - 0.06, 0.022), material, {
      at: [(x0 + x1) / 2 + 0.05, seat + 0.025, zc],
    });
    kit.blob(parent, cream, [(x0 + x1) / 2 + 0.05, seat + 0.052, zc], [0.016, 0.006, 0.016], {
      cast: false,
    });
    const pillow = kit.mesh(parent, kit.roundedBox(0.09, 0.26, span - 0.12, 0.04), linen, {
      at: [x0 + 0.07, seat + 0.15, zc],
    });
    pillow.rotation.z = -0.18;
  }
}

/** 扶手椅：布面的底座、鼓起的坐垫和靠背、两侧圆扶手，四只小木脚，搭一条抹茶色毯子。facing 同 addChair。 */
export function addArmchair(kit: PropKit, parent: Object3D, x: number, z: number, facing: number) {
  const { linen, cream, matcha, woodDark } = kit.palette;
  const group = kit.mesh(parent, kit.roundedBox(0.62, 0.16, 0.56, 0.05), linen, {
    at: [x, 0.13, z],
  });
  group.rotation.y = facing;
  const local = (forward: number, side: number, y: number): [number, number, number] => [
    x + Math.sin(facing) * forward + Math.cos(facing) * side,
    y,
    z + Math.cos(facing) * forward - Math.sin(facing) * side,
  ];
  const cushion = kit.mesh(parent, kit.roundedBox(0.44, 0.08, 0.42, 0.035), cream, {
    at: local(0.04, 0, 0.24),
  });
  cushion.rotation.y = facing;
  const back = kit.mesh(parent, kit.roundedBox(0.6, 0.36, 0.14, 0.06), linen, {
    at: local(-0.22, 0, 0.36),
  });
  back.rotation.y = facing;
  for (const side of [-0.26, 0.26]) {
    const arm = kit.mesh(parent, kit.roundedBox(0.11, 0.2, 0.52, 0.05), linen, {
      at: local(0.01, side, 0.29),
    });
    arm.rotation.y = facing;
  }
  const throwBlanket = kit.mesh(parent, kit.roundedBox(0.16, 0.3, 0.025, 0.01), matcha, {
    at: local(-0.12, 0.08, 0.36),
  });
  throwBlanket.rotation.set(-0.35, facing, 0);
  for (const forward of [-0.22, 0.22]) {
    for (const side of [-0.24, 0.24]) {
      const [legX, , legZ] = local(forward, side, 0);
      kit.cylinder(parent, woodDark, legX, legZ, [0, 0.06], 0.025);
    }
  }
}

const BOOK_COLORS = [
  "azuki",
  "cream",
  "sage",
  "kraft",
  "matcha",
  "woodLight",
  "terracotta",
] as const;

/**
 * 一排书：沿 along 方向（x 或 z）从 start 往正方向排 count 本，高矮、厚薄、颜色按序号变化，最后一本斜靠。
 * cross 是书在另一个水平方向上的中心坐标。返回这排书占的长度。
 */
export function addBookRow(
  kit: PropKit,
  parent: Object3D,
  along: "x" | "z",
  start: number,
  cross: number,
  y: number,
  count: number,
  seed: number,
) {
  let u = start;
  for (let i = 0; i < count; i++) {
    const thickness = 0.045 + seeded(seed + i) * 0.03;
    const height = 0.2 + seeded(seed * 7 + i) * 0.1;
    const depth = 0.17;
    const material =
      kit.palette[BOOK_COLORS[Math.floor(seeded(seed * 13 + i) * BOOK_COLORS.length)]];
    const leaning = i === count - 1;
    const center = u + thickness / 2 + (leaning ? 0.05 : 0);
    const book = kit.mesh(parent, kit.roundedBox(thickness, height, depth, 0.006), material, {
      at: along === "x" ? [center, y + height / 2, cross] : [cross, y + height / 2, center],
    });
    if (along === "z") {
      book.rotation.y = Math.PI / 2;
    }
    if (leaning) {
      book.rotation.z = along === "x" ? -0.35 : 0;
      book.rotation.x = along === "z" ? 0.35 : 0;
    }
    u += thickness + 0.004;
  }
  return u - start + 0.05;
}
