import type { Object3D } from "three";
import { type PropKit, seeded } from "./prop-shapes";

/**
 * 吧台里的机器：拉杆式意式咖啡机、磨豆机、复古收银机、唱片机和唱片箱。
 * 都放在台面上，坐标是底面中心，正面朝 +z（朝着店里）。
 */

/**
 * 拉杆式意式咖啡机：奶油色机身、黄铜包边和铭牌，顶上温杯架摆着倒扣的杯子；
 * 正面两组冲煮头各带一根上扬的拉杆和黑柄手柄，下面是接水盘，侧面一根蒸汽棒，机身正面一只压力表。
 */
export function addEspressoMachine(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
) {
  const { cream, brass, steel, black, porcelain, iron } = kit.palette;
  const w = 0.82;
  const d = 0.4;
  const front = z + d / 2;
  kit.box(parent, steel, [x - w / 2, x + w / 2], [y, y + 0.05], [z - d / 2, front + 0.06]);
  for (let i = 0; i < 6; i++) {
    const gx = x - 0.3 + i * 0.12;
    kit.box(
      parent,
      iron,
      [gx - 0.02, gx + 0.02],
      [y + 0.05, y + 0.054],
      [front - 0.08, front + 0.05],
      { cast: false },
    );
  }
  kit.mesh(parent, kit.roundedBox(w, 0.34, d, 0.04), cream, { at: [x, y + 0.05 + 0.17, z] });
  kit.box(
    parent,
    brass,
    [x - w / 2 - 0.005, x + w / 2 + 0.005],
    [y + 0.36, y + 0.385],
    [z - d / 2 - 0.005, front + 0.005],
  );
  kit.box(parent, brass, [x - 0.14, x + 0.14], [y + 0.26, y + 0.3], [front, front + 0.008], {
    cast: false,
  });
  // 压力表
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.05, 0],
      [0.05, 0.015],
      [0, 0.015],
    ]),
    brass,
    {
      at: [x, y + 0.17, front],
      rotation: [Math.PI / 2, 0, 0],
    },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.04, 0],
      [0, 0.004],
    ]),
    porcelain,
    {
      at: [x, y + 0.17, front + 0.015],
      rotation: [Math.PI / 2, 0, 0],
      cast: false,
    },
  );
  // 温杯架和倒扣的杯子
  kit.box(
    parent,
    steel,
    [x - w / 2 + 0.04, x + w / 2 - 0.04],
    [y + 0.385, y + 0.395],
    [z - d / 2 + 0.04, front - 0.04],
  );
  for (const [i, cx] of [-0.24, -0.08, 0.08, 0.24].entries()) {
    kit.mesh(
      parent,
      kit.lathe([
        [0, 0],
        [0.055, 0],
        [0.05, 0.07],
        [0.038, 0.08],
        [0, 0.08],
      ]),
      i % 2 === 0 ? porcelain : cream,
      { at: [x + cx, y + 0.395, z + (i % 2 === 0 ? -0.05 : 0.06)] },
    );
  }
  // 两组冲煮头：冲煮头、拉杆、手柄、杯子
  for (const gx of [x - 0.19, x + 0.19]) {
    kit.cylinder(parent, steel, gx, front + 0.05, [y + 0.15, y + 0.22], 0.05);
    kit.cylinder(parent, steel, gx, front + 0.05, [y + 0.12, y + 0.15], 0.042);
    kit.rod(parent, steel, [gx, y + 0.22, front + 0.05], [gx, y + 0.56, front + 0.16], 0.014);
    kit.blob(parent, black, [gx, y + 0.58, front + 0.165], [0.03, 0.04, 0.03]);
    kit.rod(
      parent,
      black,
      [gx, y + 0.13, front + 0.08],
      [gx + 0.02, y + 0.12, front + 0.22],
      0.016,
    );
    kit.mesh(
      parent,
      kit.lathe([
        [0, 0],
        [0.035, 0],
        [0.042, 0.06],
        [0.036, 0.06],
        [0, 0.008],
      ]),
      porcelain,
      { at: [gx, y + 0.054, front + 0.03] },
    );
  }
  // 蒸汽棒
  kit.rod(
    parent,
    steel,
    [x + w / 2 - 0.02, y + 0.28, front - 0.02],
    [x + w / 2 + 0.05, y + 0.1, front + 0.08],
    0.01,
  );
  kit.blob(parent, black, [x + w / 2 - 0.02, y + 0.3, front - 0.02], [0.025, 0.025, 0.025]);
}

/** 磨豆机：铸铁机座，奶油色机身，顶上装着咖啡豆的锥形豆仓，正面出粉口。 */
export function addGrinder(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { iron, cream, beans, glass, black, steel } = kit.palette;
  kit.mesh(parent, kit.roundedBox(0.2, 0.05, 0.24, 0.015), iron, { at: [x, y + 0.025, z + 0.02] });
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0.05],
      [0.075, 0.05],
      [0.08, 0.1],
      [0.07, 0.28],
      [0.08, 0.3],
      [0, 0.3],
    ]),
    cream,
    { at: [x, y, z - 0.02] },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0.03, 0.3],
      [0.1, 0.44],
      [0, 0.44],
    ]),
    beans,
    { at: [x, y, z - 0.02] },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0.1, 0.44],
      [0.11, 0.48],
      [0.1, 0.5],
      [0, 0.5],
    ]),
    glass,
    { at: [x, y, z - 0.02] },
  );
  kit.blob(parent, black, [x, y + 0.51, z - 0.02], [0.03, 0.02, 0.03]);
  kit.box(parent, steel, [x - 0.03, x + 0.03], [y + 0.14, y + 0.2], [z + 0.06, z + 0.1]);
  kit.box(parent, black, [x - 0.06, x + 0.06], [y + 0.08, y + 0.1], [z + 0.05, z + 0.12]);
}

/** 复古收银机：木质底柜和钱箱，斜面上两排按键，顶上一块数字牌。正面朝 +z。 */
export function addCashRegister(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { woodDark, brass, cream, azuki, black } = kit.palette;
  kit.mesh(parent, kit.roundedBox(0.42, 0.12, 0.34, 0.015), woodDark, { at: [x, y + 0.06, z] });
  kit.box(parent, brass, [x - 0.04, x + 0.04], [y + 0.05, y + 0.07], [z + 0.17, z + 0.18], {
    cast: false,
  });
  const deck = kit.mesh(parent, kit.roundedBox(0.4, 0.05, 0.24, 0.015), brass, {
    at: [x, y + 0.16, z + 0.03],
  });
  deck.rotation.x = 0.45;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const kx = x - 0.14 + col * 0.07;
      const kz = z + 0.08 - row * 0.08;
      kit.cylinder(
        parent,
        row === 0 && col === 4 ? azuki : cream,
        kx,
        kz,
        [y + 0.17 + row * 0.04, y + 0.2 + row * 0.04],
        0.022,
      );
    }
  }
  kit.mesh(parent, kit.roundedBox(0.3, 0.12, 0.1, 0.015), woodDark, { at: [x, y + 0.29, z - 0.1] });
  kit.box(parent, cream, [x - 0.11, x + 0.11], [y + 0.25, y + 0.33], [z - 0.05, z - 0.045], {
    cast: false,
  });
  kit.box(parent, black, [x - 0.08, x + 0.08], [y + 0.28, y + 0.3], [z - 0.045, z - 0.042], {
    cast: false,
  });
}

/** 唱片机：木质机座，转盘上一张黑胶和红色标签，黄铜唱臂，正面两个旋钮。正面朝 +z。 */
export function addRecordPlayer(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { woodLight, steel, black, azuki, brass, cream } = kit.palette;
  kit.mesh(parent, kit.roundedBox(0.5, 0.09, 0.38, 0.02), woodLight, { at: [x, y + 0.045, z] });
  kit.cylinder(parent, steel, x - 0.05, z, [y + 0.09, y + 0.105], 0.16);
  kit.cylinder(parent, black, x - 0.05, z, [y + 0.105, y + 0.112], 0.15);
  kit.cylinder(parent, azuki, x - 0.05, z, [y + 0.112, y + 0.115], 0.05, { cast: false });
  kit.cylinder(parent, cream, x - 0.05, z, [y + 0.112, y + 0.125], 0.006);
  kit.cylinder(parent, brass, x + 0.17, z - 0.11, [y + 0.09, y + 0.15], 0.025);
  kit.rod(parent, brass, [x + 0.17, y + 0.145, z - 0.11], [x + 0.06, y + 0.13, z + 0.06], 0.007);
  kit.box(parent, black, [x + 0.04, x + 0.08], [y + 0.12, y + 0.135], [z + 0.05, z + 0.09]);
  for (const kx of [x + 0.12, x + 0.19]) {
    kit.mesh(
      parent,
      kit.lathe([
        [0, 0],
        [0.018, 0],
        [0.018, 0.02],
        [0, 0.02],
      ]),
      black,
      {
        at: [kx, y + 0.04, z + 0.19],
        rotation: [Math.PI / 2, 0, 0],
      },
    );
  }
}

/** 唱片箱：浅木箱里竖着一排唱片，封套颜色各不相同，探出箱沿。 */
export function addRecordCrate(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { wood, woodDark } = kit.palette;
  const w = 0.46;
  const d = 0.34;
  kit.box(parent, wood, [x - w / 2, x + w / 2], [y, y + 0.02], [z - d / 2, z + d / 2]);
  for (const side of [-1, 1]) {
    kit.box(
      parent,
      wood,
      [x - w / 2, x + w / 2],
      [y, y + 0.2],
      [z + (side * d) / 2 - 0.02, z + (side * d) / 2],
    );
    kit.box(
      parent,
      woodDark,
      [x + (side * w) / 2 - 0.02, x + (side * w) / 2],
      [y, y + 0.22],
      [z - d / 2, z + d / 2],
    );
  }
  const sleeves = ["azuki", "cream", "matcha", "kraft", "sage", "terracotta", "woodLight"] as const;
  for (let i = 0; i < 8; i++) {
    const sx = x - w / 2 + 0.05 + i * 0.048;
    const tilt = (seeded(i + 40) - 0.5) * 0.2;
    const sleeve = kit.mesh(
      parent,
      kit.roundedBox(0.012, 0.3, 0.29, 0.004),
      kit.palette[sleeves[i % sleeves.length]],
      {
        at: [sx, y + 0.16, z],
      },
    );
    sleeve.rotation.z = tilt;
  }
}
