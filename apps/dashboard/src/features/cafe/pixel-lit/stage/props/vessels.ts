import type { Material, Object3D } from "three";
import type { PropKit } from "./prop-shapes";

/**
 * 器皿：杯碟、马克杯、豆罐、茶筒、一轮插、花盆、碗、铁壶、手冲壶、虹吸壶、蛋糕、面包篮、豆袋。
 * 都比真实尺寸放大约 1.3 倍，像素化后口沿、把手、收腰还能分辨。坐标是器皿底面中心。
 */

/** 咖啡杯和杯碟，杯里有咖啡。 */
export function addCupAndSaucer(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { porcelain, coffee } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.1, 0],
      [0.125, 0.014],
      [0.118, 0.02],
      [0, 0.012],
    ]),
    porcelain,
    { at: [x, y, z] },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0.012],
      [0.045, 0.012],
      [0.062, 0.03],
      [0.07, 0.09],
      [0.074, 0.104],
      [0.066, 0.104],
      [0.06, 0.036],
      [0, 0.03],
    ]),
    porcelain,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, coffee, x, z, [y + 0.08, y + 0.088], 0.063, { cast: false });
  kit.mesh(parent, kit.torus(0.026, 0.008, Math.PI), porcelain, {
    at: [x + 0.072, y + 0.065, z],
    rotation: [0, 0, -Math.PI / 2],
  });
}

/** 马克杯或汤吞杯：直筒略收口，带把手（汤吞杯没有把手）。 */
export function addMug(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  material: Material,
  handle: boolean,
) {
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.05, 0],
      [0.06, 0.008],
      [0.062, 0.11],
      [0.065, 0.125],
      [0.056, 0.125],
      [0.054, 0.014],
      [0, 0.014],
    ]),
    material,
    { at: [x, y, z] },
  );
  if (handle) {
    kit.mesh(parent, kit.torus(0.032, 0.01, Math.PI), material, {
      at: [x + 0.062, y + 0.065, z],
      rotation: [0, 0, -Math.PI / 2],
    });
  }
}

/** 咖啡豆玻璃罐：豆子装到肩部，玻璃肩和木盖。 */
export function addBeanJar(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  scale = 1,
) {
  const { beans, glass, wood } = kit.palette;
  const s = scale;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.07 * s, 0],
      [0.08 * s, 0.012 * s],
      [0.082 * s, 0.17 * s],
      [0, 0.17 * s],
    ]),
    beans,
    { at: [x, y, z] },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0.082 * s, 0.17 * s],
      [0.08 * s, 0.2 * s],
      [0.058 * s, 0.225 * s],
      [0.056 * s, 0.24 * s],
      [0, 0.24 * s],
    ]),
    glass,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, wood, x, z, [y + 0.24 * s, y + 0.27 * s], 0.064 * s);
  kit.blob(parent, wood, [x, y + 0.28 * s, z], [0.022 * s, 0.016 * s, 0.022 * s]);
  // 玻璃底和侧边的一道反光
  kit.cylinder(parent, glass, x, z, [y, y + 0.012 * s], 0.074 * s);
  kit.box(
    parent,
    glass,
    [x - 0.06 * s, x - 0.04 * s],
    [y + 0.04 * s, y + 0.15 * s],
    [z + 0.07 * s, z + 0.084 * s],
    {
      cast: false,
    },
  );
}

/** 茶筒：圆筒、贴一圈和纸标签、盖子略宽。 */
export function addTeaCanister(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  body: Material,
  label: Material,
) {
  kit.cylinder(parent, body, x, z, [y, y + 0.17], 0.068);
  kit.cylinder(parent, label, x, z, [y + 0.06, y + 0.12], 0.07);
  kit.cylinder(parent, body, x, z, [y + 0.17, y + 0.21], 0.072);
  kit.blob(parent, kit.palette.woodDark, [x, y + 0.215, z], [0.02, 0.012, 0.02]);
}

/** 一轮插：细颈花瓶插一枝花。 */
export function addBudVase(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  vase: Material,
  bloom: Material,
) {
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.035, 0],
      [0.05, 0.035],
      [0.045, 0.09],
      [0.018, 0.14],
      [0.022, 0.165],
      [0.014, 0.165],
      [0, 0.15],
    ]),
    vase,
    { at: [x, y, z] },
  );
  kit.rod(parent, kit.palette.leafMid, [x, y + 0.15, z], [x + 0.03, y + 0.32, z], 0.006);
  kit.mesh(parent, kit.leaf(0.07, 0.03), kit.palette.leafMid, {
    at: [x + 0.012, y + 0.21, z],
    rotation: [0, 0.6, -0.9],
    cast: false,
  });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    kit.blob(
      parent,
      bloom,
      [x + 0.03 + Math.cos(angle) * 0.025, y + 0.33, z + Math.sin(angle) * 0.025],
      [0.022, 0.014, 0.022],
    );
  }
  kit.blob(parent, kit.palette.cream, [x + 0.03, y + 0.336, z], [0.012, 0.01, 0.012]);
}

/** 花盆：外翻的口沿、往下收窄，里面一层土。radius 是口沿半径。 */
export function addPot(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  material: Material,
) {
  const r = radius;
  const h = height;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [r * 0.72, 0],
      [r * 0.92, h * 0.82],
      [r * 1.06, h * 0.84],
      [r * 1.06, h],
      [r * 0.94, h],
      [r * 0.9, h * 0.88],
      [0, h * 0.88],
    ]),
    material,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, kit.palette.soil, x, z, [y + h * 0.88, y + h * 0.92], r * 0.9, {
    cast: false,
  });
}

/** 一摞碗：三只碗叠起来，中间一只换颜色。 */
export function addBowlStack(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const bowl = kit.lathe([
    [0, 0],
    [0.05, 0],
    [0.095, 0.045],
    [0.105, 0.058],
    [0.096, 0.058],
    [0.048, 0.012],
    [0, 0.012],
  ]);
  for (const [i, material] of [
    kit.palette.porcelain,
    kit.palette.sage,
    kit.palette.porcelain,
  ].entries()) {
    kit.mesh(parent, bowl, material, { at: [x, y + i * 0.028, z] });
  }
}

/** 一摞小碟。 */
export function addPlateStack(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  count: number,
) {
  const plate = kit.lathe([
    [0, 0],
    [0.09, 0],
    [0.13, 0.014],
    [0.122, 0.02],
    [0, 0.012],
  ]);
  for (let i = 0; i < count; i++) {
    kit.mesh(parent, plate, i % 2 === 0 ? kit.palette.porcelain : kit.palette.cream, {
      at: [x, y + i * 0.02, z],
    });
  }
}

/** 南部铁壶：扁圆壶身、短壶嘴、提梁。 */
export function addTetsubin(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { iron, black } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.08, 0],
      [0.115, 0.035],
      [0.12, 0.075],
      [0.085, 0.12],
      [0.05, 0.13],
      [0.05, 0.14],
      [0, 0.14],
    ]),
    iron,
    { at: [x, y, z] },
  );
  kit.blob(parent, black, [x, y + 0.15, z], [0.022, 0.018, 0.022]);
  kit.rod(parent, iron, [x + 0.1, y + 0.06, z], [x + 0.17, y + 0.12, z], 0.017);
  kit.mesh(parent, kit.torus(0.1, 0.009, Math.PI), black, { at: [x, y + 0.13, z] });
}

/** 细嘴手冲壶：不锈钢壶身、鹅颈壶嘴、木把手。 */
export function addGooseneckKettle(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
) {
  const { steel, woodDark } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.08, 0],
      [0.085, 0.1],
      [0.06, 0.135],
      [0.03, 0.14],
      [0, 0.14],
    ]),
    steel,
    { at: [x, y, z] },
  );
  kit.mesh(
    parent,
    kit.tube(
      [
        [x + 0.07, y + 0.02, z],
        [x + 0.13, y + 0.05, z],
        [x + 0.15, y + 0.15, z],
        [x + 0.2, y + 0.19, z],
      ],
      0.009,
    ),
    steel,
    { at: [0, 0, 0] },
  );
  kit.mesh(parent, kit.torus(0.05, 0.012, Math.PI), woodDark, {
    at: [x - 0.08, y + 0.08, z],
    rotation: [0, 0, Math.PI / 2],
  });
}

/** 牛奶拉花缸。 */
export function addMilkPitcher(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.055, 0],
      [0.06, 0.06],
      [0.05, 0.11],
      [0.054, 0.13],
      [0, 0.12],
    ]),
    kit.palette.steel,
    { at: [x, y, z] },
  );
  kit.box(
    parent,
    kit.palette.steel,
    [x - 0.075, x - 0.05],
    [y + 0.04, y + 0.1],
    [z - 0.008, z + 0.008],
  );
}

/** 虹吸壶：底座、装着咖啡的下壶、玻璃上壶，黄铜支架。 */
export function addSiphon(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { brass, coffee, glass, woodDark } = kit.palette;
  kit.cylinder(parent, woodDark, x, z, [y, y + 0.03], 0.09);
  kit.rod(parent, brass, [x - 0.07, y + 0.03, z], [x - 0.07, y + 0.4, z], 0.008);
  kit.blob(parent, coffee, [x, y + 0.13, z], [0.075, 0.07, 0.075]);
  kit.blob(parent, glass, [x, y + 0.155, z], [0.068, 0.04, 0.068], { cast: false });
  kit.mesh(
    parent,
    kit.lathe([
      [0.012, 0.2],
      [0.012, 0.24],
      [0.05, 0.26],
      [0.055, 0.38],
      [0.06, 0.4],
      [0, 0.4],
    ]),
    glass,
    { at: [x, y, z] },
  );
  kit.box(parent, brass, [x - 0.075, x], [y + 0.32, y + 0.335], [z - 0.008, z + 0.008]);
}

/** 手冲架：木架上一只滤杯，下面接一只玻璃分享壶。 */
export function addPourOverStand(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { wood, porcelain, glass, coffee } = kit.palette;
  kit.box(parent, wood, [x - 0.14, x + 0.14], [y, y + 0.03], [z - 0.1, z + 0.1]);
  kit.box(parent, wood, [x + 0.1, x + 0.14], [y + 0.03, y + 0.32], [z - 0.03, z + 0.03]);
  kit.box(parent, wood, [x - 0.08, x + 0.14], [y + 0.28, y + 0.31], [z - 0.06, z + 0.06]);
  kit.mesh(
    parent,
    kit.lathe([
      [0.02, 0.31],
      [0.03, 0.31],
      [0.075, 0.39],
      [0.08, 0.4],
      [0, 0.4],
    ]),
    porcelain,
    { at: [x - 0.02, y, z] },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0.03],
      [0.06, 0.03],
      [0.075, 0.08],
      [0.06, 0.16],
      [0.04, 0.2],
      [0.045, 0.22],
      [0, 0.22],
    ]),
    glass,
    { at: [x - 0.02, y, z] },
  );
  kit.cylinder(parent, coffee, x - 0.02, z, [y + 0.035, y + 0.1], 0.068);
}

/** 草莓蛋糕：高脚蛋糕盘、奶油蛋糕、顶上一圈草莓。 */
export function addCakeStand(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { porcelain, cream, azuki, blush } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.07, 0],
      [0.03, 0.02],
      [0.025, 0.07],
      [0.16, 0.08],
      [0.16, 0.09],
      [0, 0.09],
    ]),
    porcelain,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, cream, x, z, [y + 0.09, y + 0.2], 0.12);
  kit.cylinder(parent, blush, x, z, [y + 0.135, y + 0.15], 0.122, { cast: false });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    kit.blob(
      parent,
      azuki,
      [x + Math.cos(angle) * 0.08, y + 0.22, z + Math.sin(angle) * 0.08],
      [0.026, 0.03, 0.026],
    );
  }
}

/** 面包篮：藤编浅筐，里面几只牛角包。 */
export function addBreadBasket(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { kraft, woodLight, honey } = kit.palette;
  kit.mesh(parent, kit.roundedBox(0.36, 0.08, 0.26, 0.03), kraft, { at: [x, y + 0.04, z] });
  kit.box(parent, woodLight, [x - 0.16, x + 0.16], [y + 0.075, y + 0.085], [z - 0.11, z + 0.11], {
    cast: false,
  });
  for (const [dx, dz, turn] of [
    [-0.08, -0.03, 0.3],
    [0.07, -0.02, -0.4],
    [0, 0.06, 1.2],
  ] as const) {
    kit.mesh(parent, kit.torus(0.05, 0.026, Math.PI * 1.2), honey, {
      at: [x + dx, y + 0.1, z + dz],
      rotation: [-Math.PI / 2, 0, turn],
    });
  }
}

/** 咖啡豆袋：牛皮纸袋，顶上折口，正面一张标签。facing 是标签朝向的世界方向。 */
export function addBeanBag(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  facing: "x" | "-x" | "z" | "-z",
  label: Material,
) {
  const { kraft, wood } = kit.palette;
  const alongX = facing === "z" || facing === "-z";
  const w = 0.17;
  const d = 0.11;
  kit.mesh(parent, kit.roundedBox(alongX ? w : d, 0.24, alongX ? d : w, 0.025), kraft, {
    at: [x, y + 0.12, z],
  });
  kit.box(
    parent,
    wood,
    alongX ? [x - w / 2, x + w / 2] : [x - d / 2 + 0.01, x + d / 2 - 0.01],
    [y + 0.23, y + 0.27],
    alongX ? [z - d / 2 + 0.01, z + d / 2 - 0.01] : [z - w / 2, z + w / 2],
  );
  const sign = facing.startsWith("-") ? -1 : 1;
  const face = d / 2 + 0.002;
  if (alongX) {
    kit.box(
      parent,
      label,
      [x - 0.05, x + 0.05],
      [y + 0.08, y + 0.16],
      [z + sign * face - 0.004, z + sign * face + 0.004],
      {
        cast: false,
      },
    );
  } else {
    kit.box(
      parent,
      label,
      [x + sign * face - 0.004, x + sign * face + 0.004],
      [y + 0.08, y + 0.16],
      [z - 0.05, z + 0.05],
      {
        cast: false,
      },
    );
  }
}
