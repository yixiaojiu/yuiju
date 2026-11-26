import type { Object3D } from "three";
import type { PropKit } from "./prop-shapes";

/**
 * 灯具：乳白玻璃吊灯、台灯、落地灯、壁灯、蜡烛。灯罩用自发光材质，灯光本身由 lit-lighting 按灯具位置放置。
 */

/** 吊灯：吊线从 topY 垂下，黄铜灯头，钟形乳白玻璃罩，罩口在 y。 */
export function addPendant(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  topY: number,
) {
  const { black, brass, warmShade } = kit.palette;
  kit.rod(parent, black, [x, topY, z], [x, y + 0.2, z], 0.008);
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0.16],
      [0.035, 0.16],
      [0.04, 0.2],
      [0.018, 0.22],
      [0, 0.22],
    ]),
    brass,
    { at: [x, y, z], cast: false },
  );
  kit.mesh(
    parent,
    kit.lathe([
      [0.13, 0],
      [0.12, 0.03],
      [0.09, 0.09],
      [0.05, 0.14],
      [0.035, 0.165],
      [0, 0.17],
    ]),
    warmShade,
    { at: [x, y, z], cast: false, receive: false },
  );
  kit.cylinder(parent, warmShade, x, z, [y, y + 0.012], 0.13, { cast: false, receive: false });
}

/** 台灯：黄铜底座和灯杆，布面锥形灯罩。 */
export function addDeskLamp(
  kit: PropKit,
  parent: Object3D,
  x: number,
  y: number,
  z: number,
  scale: number,
) {
  const s = scale;
  const { brass, fabricShade } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.09 * s, 0],
      [0.09 * s, 0.015 * s],
      [0.03 * s, 0.04 * s],
      [0, 0.04 * s],
    ]),
    brass,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, brass, x, z, [y + 0.04 * s, y + 0.27 * s], 0.014 * s);
  kit.mesh(
    parent,
    kit.lathe([
      [0.13 * s, 0.22 * s],
      [0.12 * s, 0.24 * s],
      [0.07 * s, 0.37 * s],
      [0, 0.37 * s],
    ]),
    fabricShade,
    { at: [x, y, z], cast: false, receive: false },
  );
}

/** 落地灯：铸铁圆底、细灯杆、鼓形布罩。 */
export function addFloorLamp(kit: PropKit, parent: Object3D, x: number, z: number, height: number) {
  const { iron, brass, fabricShade } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.14, 0],
      [0.13, 0.03],
      [0.03, 0.05],
      [0, 0.05],
    ]),
    iron,
    { at: [x, 0, z] },
  );
  kit.cylinder(parent, brass, x, z, [0.05, height - 0.1], 0.016);
  kit.mesh(
    parent,
    kit.lathe([
      [0.17, 0],
      [0.16, 0.2],
      [0.15, 0.22],
      [0, 0.22],
    ]),
    fabricShade,
    { at: [x, height - 0.18, z], cast: false, receive: false },
  );
}

/** 壁灯：墙上一块黄铜底板，短臂挑出一只乳白玻璃球。outward 是离开墙面的方向。 */
export function addWallSconce(
  kit: PropKit,
  parent: Object3D,
  at: readonly [number, number, number],
  outward: readonly [number, number],
) {
  const [x, y, z] = at;
  const [ox, oz] = outward;
  const { brass, warmShade } = kit.palette;
  kit.blob(
    parent,
    brass,
    [x, y, z],
    [0.04 + Math.abs(oz) * 0.01, 0.06, 0.04 + Math.abs(ox) * 0.01],
  );
  kit.rod(parent, brass, [x, y, z], [x + ox * 0.12, y + 0.04, z + oz * 0.12], 0.01);
  kit.blob(parent, warmShade, [x + ox * 0.14, y + 0.09, z + oz * 0.14], [0.065, 0.06, 0.065], {
    cast: false,
    receive: false,
  });
}

/** 蜡烛：黄铜烛台小碟、奶油色蜡烛、火苗。 */
export function addCandle(kit: PropKit, parent: Object3D, x: number, y: number, z: number) {
  const { brass, cream, flame } = kit.palette;
  kit.mesh(
    parent,
    kit.lathe([
      [0, 0],
      [0.06, 0],
      [0.07, 0.014],
      [0.064, 0.018],
      [0, 0.012],
    ]),
    brass,
    { at: [x, y, z] },
  );
  kit.cylinder(parent, cream, x, z, [y + 0.012, y + 0.12], 0.035);
  kit.blob(parent, flame, [x, y + 0.15, z], [0.016, 0.03, 0.016], { cast: false, receive: false });
}
