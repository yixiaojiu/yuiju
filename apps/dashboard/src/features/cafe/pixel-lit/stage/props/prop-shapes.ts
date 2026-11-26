import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  LatheGeometry,
  type Material,
  Mesh,
  type Object3D,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { LitMaterials } from "../lit-materials";

export type Range = readonly [number, number];
export type Point3 = readonly [number, number, number];

/** 摆放一个网格：位置、绕 x/y/z 的旋转（弧度）、缩放，默认投射并接收阴影。 */
export type Placement = {
  at: Point3;
  rotation?: Point3;
  scale?: Point3;
  cast?: boolean;
  receive?: boolean;
};

/**
 * 道具建模工具：共用的调色板材质，加上几种造型（方块、圆柱、椭球、车削体、倒角方块、圆环、管、叶片）。
 * 每次调用新建的几何体都登记在这里，场景销毁时一起释放。
 */
export function createPropKit(materials: LitMaterials) {
  const geometries: BufferGeometry[] = [];
  const own = <T extends BufferGeometry>(geometry: T) => {
    geometries.push(geometry);
    return geometry;
  };
  const unitBox = own(new BoxGeometry(1, 1, 1));
  const unitCylinder = own(new CylinderGeometry(1, 1, 1, 16));
  const unitSphere = own(new SphereGeometry(1, 14, 10));

  const mesh = (
    parent: Object3D,
    geometry: BufferGeometry,
    material: Material,
    place: Placement,
  ) => {
    const result = new Mesh(geometry, material);
    result.position.set(...place.at);
    if (place.rotation) {
      result.rotation.set(...place.rotation);
    }
    if (place.scale) {
      result.scale.set(...place.scale);
    }
    result.castShadow = place.cast ?? true;
    result.receiveShadow = place.receive ?? true;
    parent.add(result);
    return result;
  };

  /** 轴对齐的方块，按各轴的起止坐标给出。 */
  const box = (
    parent: Object3D,
    material: Material,
    [x0, x1]: Range,
    [y0, y1]: Range,
    [z0, z1]: Range,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) =>
    mesh(parent, unitBox, material, {
      at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      scale: [x1 - x0, y1 - y0, z1 - z0],
      ...shadow,
    });

  /** 竖直的圆柱，底面圆心在 (x, y0, z)。 */
  const cylinder = (
    parent: Object3D,
    material: Material,
    x: number,
    z: number,
    [y0, y1]: Range,
    radius: number,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) =>
    mesh(parent, unitCylinder, material, {
      at: [x, (y0 + y1) / 2, z],
      scale: [radius, y1 - y0, radius],
      ...shadow,
    });

  /** 椭球，按中心和三个半径给出。 */
  const blob = (
    parent: Object3D,
    material: Material,
    at: Point3,
    radii: Point3,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) => mesh(parent, unitSphere, material, { at, scale: radii, ...shadow });

  /** 两点之间的细杆（腿、拉杆、吊杆），横截面是圆。 */
  const rod = (parent: Object3D, material: Material, from: Point3, to: Point3, radius: number) => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const length = a.distanceTo(b);
    const result = mesh(parent, unitCylinder, material, {
      at: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      scale: [radius, length, radius],
    });
    result.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.sub(a).normalize());
    return result;
  };

  /**
   * 车削体：profile 是一串 [半径, 高度]，从底往上绕竖直轴转一圈。
   * 杯、罐、花瓶、灯罩、凳面都用它做出口沿、收腰和鼓肚。
   */
  const lathe = (profile: readonly (readonly [number, number])[], segments = 18) =>
    own(
      new LatheGeometry(
        profile.map(([r, y]) => new Vector2(r, y)),
        segments,
      ),
    );

  /** 倒角方块：家具的台面、坐垫、机身，边角圆润。 */
  const roundedBox = (width: number, height: number, depth: number, radius: number) =>
    own(new RoundedBoxGeometry(width, height, depth, 2, radius));

  /** 平放在 xz 平面上的圆环：凳子的脚踏圈、壶把。 */
  const torus = (radius: number, tube: number, arc = Math.PI * 2) =>
    own(new TorusGeometry(radius, tube, 6, 20, arc));

  /** 沿一串点弯过去的细管：鹅颈壶嘴、垂下来的藤蔓、电线。 */
  const tube = (points: readonly Point3[], radius: number) =>
    own(
      new TubeGeometry(
        new CatmullRomCurve3(points.map((p) => new Vector3(...p))),
        points.length * 6,
        radius,
        5,
        false,
      ),
    );

  /** 叶片：两头尖、中间宽的薄片，长度沿 +y，叶柄在原点。 */
  const leaf = (length: number, width: number) => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(width, length * 0.45, 0, length);
    shape.quadraticCurveTo(-width, length * 0.45, 0, 0);
    return own(new ShapeGeometry(shape, 4));
  };

  const m = materials.material;
  const palette = {
    wood: m("#5e3a27", { roughness: 0.84 }),
    woodDark: m("#3a2217", { roughness: 0.86 }),
    woodLight: m("#8c5c3b", { roughness: 0.8 }),
    honey: m("#c98d4e", { roughness: 0.56 }),
    porcelain: m("#f4eee4", { roughness: 0.38 }),
    cream: m("#efe0be", { roughness: 0.8 }),
    linen: m("#e6d8b9", { roughness: 0.94 }),
    iron: m("#3d3533", { roughness: 0.5, metalness: 0.3 }),
    brass: m("#c5964a", { roughness: 0.36, metalness: 0.45 }),
    steel: m("#b8afa3", { roughness: 0.3, metalness: 0.5 }),
    black: m("#2a211d", { roughness: 0.6 }),
    terracotta: m("#b8694a", { roughness: 0.85 }),
    soil: m("#3b2a20", { roughness: 0.95 }),
    leafDark: m("#3f6b3a", { roughness: 0.8, doubleSide: true }),
    leafMid: m("#56844a", { roughness: 0.8, doubleSide: true }),
    leafLight: m("#78a65b", { roughness: 0.78, doubleSide: true }),
    moss: m("#5d7a3a", { roughness: 0.95 }),
    kraft: m("#c9a46b", { roughness: 0.86 }),
    azuki: m("#a45448", { roughness: 0.8 }),
    matcha: m("#879f64", { roughness: 0.8 }),
    sage: m("#788f73", { roughness: 0.8 }),
    beans: m("#5a3a26", { roughness: 0.7 }),
    coffee: m("#2e1b10", { roughness: 0.3 }),
    violet: m("#9b7cc8", { roughness: 0.78 }),
    blush: m("#e3a49a", { roughness: 0.8 }),
    leather: m("#8f5236", { roughness: 0.62 }),
    // 玻璃不做透明：暖白的瓶身加一点自发光，轮廓一眼可辨。
    glass: m("#efe6d2", { roughness: 0.2, emissive: "#ffe2b0", emissiveIntensity: 0.12 }),
    warmShade: m("#fff3d6", { emissive: "#ffca7a", emissiveIntensity: 1.95, roughness: 0.28 }),
    fabricShade: m("#f6e6c4", { emissive: "#ffbe6a", emissiveIntensity: 1.2, roughness: 0.8 }),
    flame: m("#fff6dc", { emissive: "#ffbe55", emissiveIntensity: 2.3, roughness: 0.2 }),
    bulb: m("#fff3d1", { emissive: "#ffbf60", emissiveIntensity: 1.95, roughness: 0.2 }),
    shelfStrip: m("#ffdfb0", { emissive: "#ffb35c", emissiveIntensity: 1.25, roughness: 0.5 }),
  };

  return {
    palette,
    mesh,
    box,
    cylinder,
    blob,
    rod,
    lathe,
    roundedBox,
    torus,
    tube,
    leaf,
    dispose() {
      for (const geometry of geometries) {
        geometry.dispose();
      }
    },
  };
}

export type PropKit = ReturnType<typeof createPropKit>;

/** 按序号取一个 0~1 的固定伪随机数，让叶片、书脊的变化每次加载都一样。 */
export function seeded(index: number) {
  const n = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
}
