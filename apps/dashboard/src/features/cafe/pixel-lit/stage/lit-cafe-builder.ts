import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { LitMaterials } from "./lit-materials";
import type { LitTextures } from "./lit-textures";

type Range = readonly [number, number];

/** 1 屏幕像素对应的世界宽度（米），约 36 像素/米（对标《东方华心传》58px 角色尺度，满屏铺满视口）。 */
export const LIT_PIXEL = 0.028;
/** 固定 30° 俯视正交角（sin=0.5），保证地面贴图 Z 轴 2:1 与竖直立牌 1/cos(30°) 严格投影为正方形像素。 */
export const LIT_ELEVATION = Math.PI / 6;
export const LIT_COS = Math.cos(LIT_ELEVATION);
export const LIT_SIN = Math.sin(LIT_ELEVATION);

export const LIT_ROOM = {
  minX: -5.6,
  maxX: 5.6,
  minZ: -3.8,
  maxZ: 3.4,
  wallHeight: 3.05,
} as const;

/**
 * 家具按角色的 Q 版比例做矮：角色约 1.8 头身、身高约 1.1 米，台面在她胸口，0.40 米。
 * 墙、窗、墙上的置物架、吊灯保持原尺寸。
 */
export const LIT_BAR = {
  top: 0.4,
  front: { minX: -2.0, maxX: 2.0, minZ: 0.45, maxZ: 1.1 },
  left: { minX: -2.0, maxX: -1.4, minZ: -2.35, maxZ: 0.45 },
  right: { minX: 1.4, maxX: 2.0, minZ: -2.35, maxZ: 0.45 },
} as const;

export const LIT_WORKTOP = {
  minX: -2.25,
  maxX: 1.45,
  minZ: LIT_ROOM.minZ,
  maxZ: -3.12,
} as const;

export const LIT_WALKABLE = { minX: -5.2, maxX: 5.2, minZ: -3.4, maxZ: 3.05 } as const;
export const LIT_CUSTOMER_RADIUS = 0.24;

/**
 * 走不过去的家具，按台面的外沿算。吧台拆成前台、左右两翼和后墙操作台四块，里面是店员的走动区；
 * 左后角的腰门和右后角的缺口都不挡，可以走出吧台（腰门是实心木板，走过时直接穿过）。
 */
export const LIT_OBSTACLES = [
  ...[LIT_BAR.front, LIT_BAR.left, LIT_BAR.right].map((part) => ({
    minX: part.minX - 0.04,
    maxX: part.maxX + 0.04,
    minZ: part.minZ - 0.04,
    maxZ: part.maxZ + 0.04,
  })),
  {
    minX: LIT_WORKTOP.minX - 0.04,
    maxX: LIT_WORKTOP.maxX + 0.04,
    minZ: LIT_ROOM.minZ,
    maxZ: LIT_WORKTOP.maxZ + 0.05,
  },
  { minX: LIT_ROOM.minX, maxX: -2.65, minZ: LIT_ROOM.minZ, maxZ: -3.05 },
  { minX: 2.8, maxX: 4.5, minZ: LIT_ROOM.minZ, maxZ: -3.15 },
  { minX: 4.6, maxX: LIT_ROOM.maxX, minZ: LIT_ROOM.minZ, maxZ: -2.75 },
  { minX: -4.6, maxX: -3.6, minZ: -1.7, maxZ: -0.8 },
  { minX: 3.6, maxX: 4.6, minZ: -1.5, maxZ: -0.6 },
  { minX: -5.2, maxX: -3.85, minZ: 1.85, maxZ: 2.35 },
  { minX: 3.4, maxX: 5.15, minZ: 1.45, maxZ: 2.4 },
] as const;

export type LitCafeHandles = {
  root: Group;
  fanBlades: Group;
  windowBackdropMaterial: MeshStandardMaterial;
  kitchenPaperMaterial: MeshStandardMaterial;
  accentShadeMaterial: MeshStandardMaterial;
  pendantPositions: Vector3[];
  steamAnchors: Vector3[];
  dispose: () => void;
};

/**
 * 日式喫茶店 3D 像素贴图场景：
 * 建筑、家具、器皿与自发光灯罩全部由程序化 3D 几何体构成，投射并接收真实 3D 软阴影，不依赖外部 AI 生成图片。
 */
export function buildLitCafe(textures: LitTextures, materials: LitMaterials): LitCafeHandles {
  const root = new Group();
  const unitBox = new BoxGeometry(1, 1, 1);
  const unitCylinder = new CylinderGeometry(1, 1, 1, 16);
  const unitSphere = new SphereGeometry(1, 14, 10);
  const pendantShadeGeo = new CylinderGeometry(0.08, 0.21, 0.22, 16);
  const unitFloorPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const unitStandee = new PlaneGeometry(1, 1);
  unitStandee.translate(0, 0.5, 0);

  const addBox = (
    parent: Group,
    mat: Material,
    [x0, x1]: Range,
    [y0, y1]: Range,
    [z0, z1]: Range,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) => {
    const mesh = new Mesh(unitBox, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.scale.set(x1 - x0, y1 - y0, z1 - z0);
    mesh.castShadow = shadow.cast ?? true;
    mesh.receiveShadow = shadow.receive ?? true;
    parent.add(mesh);
    return mesh;
  };

  const addCylinder = (
    parent: Group,
    mat: Material,
    x: number,
    z: number,
    [y0, y1]: Range,
    radius: number,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) => {
    const mesh = new Mesh(unitCylinder, mat);
    mesh.position.set(x, (y0 + y1) / 2, z);
    mesh.scale.set(radius, y1 - y0, radius);
    mesh.castShadow = shadow.cast ?? true;
    mesh.receiveShadow = shadow.receive ?? true;
    parent.add(mesh);
    return mesh;
  };

  const addBlob = (
    parent: Group,
    mat: Material,
    [x, y, z]: readonly [number, number, number],
    [rx, ry, rz]: readonly [number, number, number],
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) => {
    const mesh = new Mesh(unitSphere, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(rx, ry, rz);
    mesh.castShadow = shadow.cast ?? true;
    mesh.receiveShadow = shadow.receive ?? true;
    parent.add(mesh);
    return mesh;
  };

  const addFloorPatch = (
    parent: Group,
    mat: Material,
    [x0, x1]: Range,
    [z0, z1]: Range,
    y: number,
  ) => {
    const mesh = new Mesh(unitFloorPlane, mat);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.scale.set(x1 - x0, 1, z1 - z0);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // --- 基础像素建筑材质 ---
  const woodFloorMat = materials.material("#ffffff", {
    map: textures.woodFloorColor,
    roughnessMap: textures.woodFloorRoughness,
    roughness: 0.72,
    metalness: 0.05,
  });
  const wood = materials.material("#5e3a27", { roughness: 0.84 });
  const woodDark = materials.material("#3a2217", { roughness: 0.86 });
  const woodSlats = materials.material("#ffffff", {
    map: textures.woodSlatsColor,
    roughness: 0.82,
  });
  const honey = materials.material("#ffffff", {
    map: textures.honeyWoodColor,
    roughnessMap: textures.honeyWoodRoughness,
    roughness: 0.54,
    metalness: 0.05,
  });
  const wallMat = materials.material("#ffffff", { map: textures.creamWallColor, roughness: 0.9 });

  const windowBackdropMaterial = materials.material("#ffe6b3", {
    emissive: "#ffe09e",
    emissiveIntensity: 2.25,
    roughness: 1,
  });
  const kitchenPaperMaterial = materials.material("#ffffff", {
    map: textures.shojiPaperColor,
    emissive: "#ffa84d",
    emissiveIntensity: 0.95,
    roughness: 0.9,
  });
  const shelfStripMaterial = materials.material("#ffdfb0", {
    emissive: "#ffb35c",
    emissiveIntensity: 1.25,
    roughness: 0.5,
  });
  const fairyBulbMaterial = materials.material("#fff3d1", {
    emissive: "#ffbf60",
    emissiveIntensity: 1.95,
    roughness: 0.2,
  });

  const backZ = LIT_ROOM.minZ;

  // 1. 地板与前沿木收边、织纹地毯
  addBox(
    root,
    woodFloorMat,
    [LIT_ROOM.minX, LIT_ROOM.maxX],
    [-0.16, 0],
    [LIT_ROOM.minZ, LIT_ROOM.maxZ],
    { cast: false, receive: true },
  );
  addBox(
    root,
    woodDark,
    [LIT_ROOM.minX - 0.24, LIT_ROOM.maxX + 0.24],
    [-0.16, 0.01],
    [LIT_ROOM.maxZ, LIT_ROOM.maxZ + 0.14],
    { cast: false, receive: true },
  );
  addFloorPatch(
    root,
    materials.material("#ffffff", { map: textures.rugColor, roughness: 0.95 }),
    [-1.92, 1.92],
    [1.65, 2.77],
    0.006,
  );
  // 门口地垫
  addFloorPatch(
    root,
    materials.material("#7d583a", { roughness: 0.95 }),
    [-0.72, 0.72],
    [2.9, 3.34],
    0.006,
  );

  // 2. 镂空百叶窗的后墙 + 左右木框墙
  const win = { minX: -5.05, maxX: -2.75, minY: 1.18, maxY: 2.72 };
  addBox(root, woodSlats, [LIT_ROOM.minX, LIT_ROOM.maxX], [0, 1.06], [backZ - 0.14, backZ]);
  addBox(
    root,
    woodDark,
    [LIT_ROOM.minX, LIT_ROOM.maxX],
    [1.06, 1.14],
    [backZ - 0.16, backZ + 0.04],
  );
  addBox(
    root,
    wallMat,
    [LIT_ROOM.minX, win.minX],
    [1.14, LIT_ROOM.wallHeight],
    [backZ - 0.14, backZ],
  );
  addBox(
    root,
    wallMat,
    [win.maxX, LIT_ROOM.maxX],
    [1.14, LIT_ROOM.wallHeight],
    [backZ - 0.14, backZ],
  );
  addBox(root, wallMat, [win.minX, win.maxX], [1.14, win.minY], [backZ - 0.14, backZ]);
  addBox(
    root,
    wallMat,
    [win.minX, win.maxX],
    [win.maxY, LIT_ROOM.wallHeight],
    [backZ - 0.14, backZ],
  );
  addBox(
    root,
    woodDark,
    [LIT_ROOM.minX - 0.24, LIT_ROOM.maxX + 0.24],
    [LIT_ROOM.wallHeight, LIT_ROOM.wallHeight + 0.14],
    [backZ - 0.18, backZ + 0.08],
  );
  addBox(
    root,
    woodDark,
    [LIT_ROOM.minX - 0.24, LIT_ROOM.minX],
    [-0.16, LIT_ROOM.wallHeight + 0.14],
    [backZ - 0.18, LIT_ROOM.maxZ + 0.14],
  );
  addBox(
    root,
    woodDark,
    [LIT_ROOM.maxX, LIT_ROOM.maxX + 0.24],
    [-0.16, LIT_ROOM.wallHeight + 0.14],
    [backZ - 0.18, LIT_ROOM.maxZ + 0.14],
  );

  // 左窗木框 + 发光底板 + 6 片百叶木条
  const winMidX = (win.minX + win.maxX) / 2;
  addBox(
    root,
    woodDark,
    [win.minX - 0.08, win.maxX + 0.08],
    [win.minY - 0.08, win.minY],
    [backZ - 0.16, backZ + 0.1],
  );
  addBox(
    root,
    woodDark,
    [win.minX - 0.08, win.maxX + 0.08],
    [win.maxY, win.maxY + 0.08],
    [backZ - 0.16, backZ + 0.08],
  );
  addBox(
    root,
    woodDark,
    [win.minX - 0.08, win.minX],
    [win.minY, win.maxY],
    [backZ - 0.16, backZ + 0.08],
  );
  addBox(
    root,
    woodDark,
    [win.maxX, win.maxX + 0.08],
    [win.minY, win.maxY],
    [backZ - 0.16, backZ + 0.08],
  );
  addBox(
    root,
    woodDark,
    [winMidX - 0.045, winMidX + 0.045],
    [win.minY, win.maxY],
    [backZ - 0.14, backZ + 0.05],
  );
  addBox(
    root,
    windowBackdropMaterial,
    [win.minX, win.maxX],
    [win.minY, win.maxY],
    [backZ - 0.16, backZ - 0.12],
    { cast: false, receive: false },
  );
  for (let i = 0; i < 6; i++) {
    const y = win.minY + ((i + 0.5) / 6) * (win.maxY - win.minY);
    const slat = new Mesh(unitBox, woodDark);
    slat.position.set(winMidX, y, backZ - 0.01);
    slat.scale.set(win.maxX - win.minX, 0.072, 0.06);
    slat.rotation.x = -0.3;
    slat.castShadow = true;
    slat.receiveShadow = false;
    root.add(slat);
  }

  // 3. 窗下木长椅与方正像素座布团/靠垫
  addBox(root, wood, [LIT_ROOM.minX + 0.06, -2.72], [0, 0.23], [backZ, -3.1]);
  addBox(root, honey, [LIT_ROOM.minX + 0.06, -2.72], [0.23, 0.27], [backZ, -3.06]);
  for (const [bx, col] of [
    [-4.92, "#79a35b"],
    [-4.05, "#96453b"],
    [-3.18, "#79a35b"],
  ] as const) {
    addBox(
      root,
      materials.material(col, { roughness: 0.92 }),
      [bx - 0.32, bx + 0.32],
      [0.27, 0.33],
      [-3.64, -3.14],
    );
    addBox(
      root,
      materials.material("#ede3c8", { roughness: 0.94 }),
      [bx - 0.28, bx + 0.28],
      [0.33, 0.62],
      [backZ + 0.02, -3.6],
    );
  }

  // 4. 旋转木吊扇（移至左窗前上方，让旋转软阴影刚好斜落在左侧木地板与圆桌光束中）
  const fanGroup = new Group();
  fanGroup.position.set(-4.05, 2.76, -2.75);
  addBox(fanGroup, woodDark, [-0.04, 0.04], [0.02, 0.32], [-0.04, 0.04], {
    cast: true,
    receive: false,
  });
  addBox(fanGroup, woodDark, [-0.14, 0.14], [-0.04, 0.05], [-0.14, 0.14], {
    cast: true,
    receive: false,
  });
  const fanBlades = new Group();
  for (let i = 0; i < 4; i++) {
    const blade = new Mesh(unitBox, woodDark);
    const angle = (i * Math.PI) / 2;
    blade.position.set(Math.cos(angle) * 0.62, 0, Math.sin(angle) * 0.62);
    blade.scale.set(0.92, 0.04, 0.2);
    blade.rotation.y = -angle;
    blade.castShadow = true;
    blade.receiveShadow = false;
    fanBlades.add(blade);
  }
  fanGroup.add(fanBlades);
  root.add(fanGroup);

  // 5. 后墙右中：日式后厨推拉门 + 黑板菜单 + 像素挂画 + 2×2 像素方格串灯
  const door = { minX: 1.62, maxX: 2.68, top: 2.36 };
  addBox(
    root,
    woodDark,
    [door.minX - 0.06, door.maxX + 0.06],
    [0, door.top + 0.06],
    [backZ, backZ + 0.06],
  );
  addBox(root, woodSlats, [door.minX, door.maxX], [0.02, 1.02], [backZ + 0.03, backZ + 0.08]);
  addBox(
    root,
    kitchenPaperMaterial,
    [door.minX + 0.04, door.maxX - 0.04],
    [1.06, door.top - 0.04],
    [backZ + 0.04, backZ + 0.065],
    { cast: false, receive: false },
  );
  for (const x of [door.minX + 0.36, door.minX + 0.7]) {
    addBox(root, woodDark, [x - 0.02, x + 0.02], [1.04, door.top], [backZ + 0.06, backZ + 0.095]);
  }
  for (const y of [1.46, 1.88]) {
    addBox(
      root,
      woodDark,
      [door.minX, door.maxX],
      [y - 0.02, y + 0.02],
      [backZ + 0.06, backZ + 0.095],
    );
  }

  // 黑板与挂画（严格按像素尺寸换算！）
  addBox(
    root,
    materials.material("#ffffff", { map: textures.chalkboardColor, roughness: 0.88 }),
    [3.0, 4.28],
    [1.46, 2.29],
    [backZ + 0.01, backZ + 0.06],
    { cast: false, receive: true },
  );
  addBox(
    root,
    materials.material("#ffffff", { map: textures.paintingWarm, roughness: 0.82 }),
    [4.56, 5.28],
    [1.52, 2.16],
    [backZ + 0.01, backZ + 0.055],
    { cast: false, receive: true },
  );

  // 像素方格串灯（每颗严格 2×2 像素方块！）
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const x = Math.round((1.65 + t * 3.65) / LIT_PIXEL) * LIT_PIXEL;
    const y = 2.82 - Math.sin(t * Math.PI) * 0.14;
    addBox(
      root,
      fairyBulbMaterial,
      [x - LIT_PIXEL, x + LIT_PIXEL],
      [y - LIT_PIXEL, y + LIT_PIXEL],
      [backZ + 0.06, backZ + 0.12],
      { cast: false, receive: false },
    );
  }

  // 6. 后墙操作台 + 顶天木置物架（器物使用真像素立牌条带！）
  addBox(
    root,
    woodSlats,
    [LIT_WORKTOP.minX, LIT_WORKTOP.maxX],
    [0, LIT_BAR.top - 0.06],
    [backZ, LIT_WORKTOP.maxZ],
  );
  addBox(
    root,
    honey,
    [LIT_WORKTOP.minX - 0.04, LIT_WORKTOP.maxX + 0.04],
    [LIT_BAR.top - 0.06, LIT_BAR.top],
    [backZ, LIT_WORKTOP.maxZ + 0.05],
  );
  const shelfRowMat = materials.spriteCardMaterial(textures.shelfRowItems);
  for (const y of [1.46, 1.98, 2.5]) {
    addBox(
      root,
      woodDark,
      [LIT_WORKTOP.minX, LIT_WORKTOP.maxX],
      [y - 0.06, y],
      [backZ, backZ + 0.32],
    );
    addBox(
      root,
      shelfStripMaterial,
      [LIT_WORKTOP.minX + 0.08, LIT_WORKTOP.maxX - 0.08],
      [y - 0.076, y - 0.06],
      [backZ + 0.04, backZ + 0.09],
      { cast: false, receive: false },
    );
    const strip = new Mesh(unitStandee, shelfRowMat);
    strip.position.set((LIT_WORKTOP.minX + LIT_WORKTOP.maxX) / 2, y, backZ + 0.16);
    strip.scale.set(57 * LIT_PIXEL * 2.48, ((8 * LIT_PIXEL) / LIT_COS) * 2.48, 1);
    strip.castShadow = true;
    strip.receiveShadow = true;
    root.add(strip);
  }
  for (const x of [LIT_WORKTOP.minX, -1.02, 0.22, LIT_WORKTOP.maxX]) {
    addBox(
      root,
      woodDark,
      [x - 0.045, x + 0.045],
      [LIT_BAR.top, LIT_ROOM.wallHeight],
      [backZ, backZ + 0.32],
    );
  }

  // 7. コ字实木吧台 + 左端木栅腰门 + 右前景杂货木台（带高侧隔断投出前景大阴影）
  for (const part of [LIT_BAR.front, LIT_BAR.left, LIT_BAR.right]) {
    addBox(
      root,
      woodDark,
      [part.minX + 0.05, part.maxX - 0.05],
      [0, 0.1],
      [part.minZ + 0.05, part.maxZ - 0.05],
    );
    addBox(
      root,
      woodSlats,
      [part.minX, part.maxX],
      [0.1, LIT_BAR.top - 0.06],
      [part.minZ, part.maxZ],
    );
    addBox(
      root,
      honey,
      [part.minX - 0.04, part.maxX + 0.04],
      [LIT_BAR.top - 0.06, LIT_BAR.top],
      [part.minZ - 0.04, part.maxZ + 0.04],
    );
  }
  for (const px of [LIT_BAR.front.minX, LIT_BAR.front.maxX]) {
    addBox(
      root,
      woodDark,
      [px - 0.08, px + 0.08],
      [0, LIT_BAR.top + 0.04],
      [LIT_BAR.front.maxZ - 0.08, LIT_BAR.front.maxZ + 0.08],
    );
  }
  // 腰门
  addBox(
    root,
    woodSlats,
    [LIT_BAR.left.minX + 0.16, LIT_BAR.left.maxX - 0.16],
    [0, LIT_BAR.top / 2],
    [LIT_WORKTOP.maxZ, LIT_BAR.left.minZ],
  );
  addBox(
    root,
    honey,
    [LIT_BAR.left.minX + 0.12, LIT_BAR.left.maxX - 0.12],
    [LIT_BAR.top - 0.08, LIT_BAR.top],
    [LIT_WORKTOP.maxZ, LIT_BAR.left.minZ],
  );

  // 右前景杂货木台与高隔断
  const displayTop = 0.43;
  addBox(root, wood, [3.5, 5.05], [0, displayTop - 0.06], [1.55, 2.3]);
  addBox(root, honey, [3.46, 5.1], [displayTop - 0.06, displayTop], [1.51, 2.34]);
  addBox(root, woodDark, [4.88, 5.18], [0, 1.55], [1.5, 2.4]);

  // --- 8. 纯 3D 块面家具、器皿与自发光灯具 ---
  const porcelain = materials.material("#f4eee4", { roughness: 0.42 });
  const iron = materials.material("#3d3533", { roughness: 0.52, metalness: 0.25 });
  const brass = materials.material("#c5964a", { roughness: 0.38, metalness: 0.42 });
  const terracotta = materials.material("#b8694a", { roughness: 0.85 });
  const leafDark = materials.material("#4e7a42", { roughness: 0.84 });
  const leafLight = materials.material("#6f9c54", { roughness: 0.82 });
  const kraft = materials.material("#c9a46b", { roughness: 0.86 });
  const cream = materials.material("#efe0be", { roughness: 0.8 });
  const azuki = materials.material("#a45448", { roughness: 0.8 });
  const matcha = materials.material("#879f64", { roughness: 0.8 });
  const sage = materials.material("#788f73", { roughness: 0.8 });

  const warmShadeMaterial = materials.material("#fff3d6", {
    emissive: "#ffca7a",
    emissiveIntensity: 1.95,
    roughness: 0.28,
  });
  const candleFlameMaterial = materials.material("#fff6dc", {
    emissive: "#ffbe55",
    emissiveIntensity: 2.3,
    roughness: 0.2,
  });
  const accentShadeMaterial = materials.material("#e6f4ff", {
    emissive: "#9bd0ff",
    emissiveIntensity: 2.1,
    roughness: 0.28,
  });

  const top = LIT_BAR.top;
  const frontMidZ = (LIT_BAR.front.minZ + LIT_BAR.front.maxZ) / 2;

  // 操作台正中：拉杆意式咖啡机 + 浓缩双杯 + 磨豆机与手冲壶
  addBox(root, cream, [-0.95, -0.08], [top, top + 0.54], [-3.72, -3.22]);
  addBox(root, brass, [-0.97, -0.06], [top + 0.54, top + 0.6], [-3.73, -3.21]);
  addBox(root, iron, [-0.9, -0.13], [top, top + 0.05], [-3.22, -3.14]);
  for (const gx of [-0.7, -0.33]) {
    addBox(root, iron, [gx - 0.08, gx + 0.08], [top + 0.24, top + 0.34], [-3.26, -3.15]);
    addBox(root, brass, [gx - 0.016, gx + 0.016], [top + 0.34, top + 0.48], [-3.2, -3.16]);
    addCylinder(root, porcelain, gx, -3.18, [top + 0.05, top + 0.15], 0.06);
  }
  addBox(root, iron, [0.38, 0.68], [top, top + 0.38], [-3.65, -3.35]);
  addCylinder(root, woodDark, 0.53, -3.5, [top + 0.38, top + 0.58], 0.13);
  addBlob(root, brass, [0.98, top + 0.13, -3.45], [0.13, 0.12, 0.13]);

  // 吧台左翼：手冲咖啡木架、滤杯与分享壶
  addBox(root, woodDark, [-1.86, -1.54], [top, top + 0.04], [-1.36, -0.96]);
  addBox(root, woodDark, [-1.84, -1.8], [top + 0.04, top + 0.28], [-1.3, -1.02]);
  addBox(root, woodDark, [-1.6, -1.56], [top + 0.04, top + 0.28], [-1.3, -1.02]);
  addBox(root, woodDark, [-1.86, -1.54], [top + 0.26, top + 0.3], [-1.32, -1.0]);
  addCylinder(root, porcelain, -1.7, -1.16, [top + 0.3, top + 0.42], 0.09);
  addBlob(root, cream, [-1.7, top + 0.13, -1.16], [0.1, 0.09, 0.1]);

  // 吧台前段：白瓷盘草莓蛋糕、牛角包木篮、复古收银机、黄铜发光台灯
  addCylinder(root, porcelain, -1.35, frontMidZ + 0.04, [top, top + 0.03], 0.22);
  addCylinder(root, cream, -1.35, frontMidZ + 0.04, [top + 0.03, top + 0.19], 0.15);
  addCylinder(root, porcelain, -1.35, frontMidZ + 0.04, [top + 0.11, top + 0.14], 0.154);
  for (const [dx, dz] of [
    [-0.05, -0.03],
    [0.05, -0.02],
    [0, 0.05],
  ] as const) {
    addBlob(root, azuki, [-1.35 + dx, top + 0.22, frontMidZ + 0.04 + dz], [0.038, 0.042, 0.038]);
  }

  addBox(root, kraft, [0.12, 0.56], [top, top + 0.1], [frontMidZ - 0.14, frontMidZ + 0.18]);
  for (const [bx, bz] of [
    [0.24, -0.03],
    [0.42, 0.03],
    [0.33, 0.09],
  ] as const) {
    addBlob(root, brass, [bx, top + 0.13, frontMidZ + bz], [0.085, 0.055, 0.065]);
  }

  addBox(
    root,
    materials.material("#6e5c49", { roughness: 0.65 }),
    [0.74, 1.26],
    [top, top + 0.26],
    [frontMidZ - 0.16, frontMidZ + 0.16],
  );
  addBox(
    root,
    woodDark,
    [0.78, 1.22],
    [top + 0.26, top + 0.37],
    [frontMidZ - 0.14, frontMidZ + 0.02],
  );
  addBox(root, cream, [0.84, 1.16], [top + 0.15, top + 0.22], [frontMidZ + 0.16, frontMidZ + 0.18]);

  // 台灯构造器（底座 + 细灯杆 + 自发光球罩）
  const addDeskLamp = (lx: number, ly: number, lz: number, shadeMat: Material, scale = 1) => {
    addCylinder(root, brass, lx, lz, [ly, ly + 0.035 * scale], 0.11 * scale);
    addCylinder(root, brass, lx, lz, [ly + 0.035 * scale, ly + 0.34 * scale], 0.022 * scale);
    addBlob(
      root,
      shadeMat,
      [lx, ly + 0.4 * scale, lz],
      [0.15 * scale, 0.13 * scale, 0.15 * scale],
      { cast: false, receive: false },
    );
  };

  addDeskLamp(1.66, top, frontMidZ + 0.04, warmShadeMaterial);

  // 右前景陈列台：冷暖联动氛围台灯 + 咖啡豆袋与茶筒
  addDeskLamp(3.85, displayTop, 1.95, accentShadeMaterial, 1.05);
  for (const bx of [4.22, 4.5]) {
    addBox(root, kraft, [bx, bx + 0.2], [displayTop, displayTop + 0.3], [1.82, 2.04]);
    addBox(
      root,
      woodDark,
      [bx + 0.05, bx + 0.15],
      [displayTop + 0.11, displayTop + 0.19],
      [2.04, 2.055],
    );
  }
  addCylinder(root, matcha, 4.76, 1.88, [displayTop, displayTop + 0.18], 0.075);
  addCylinder(root, azuki, 4.74, 2.12, [displayTop, displayTop + 0.22], 0.075);

  // 四张吧台高脚圆凳
  for (const [sx, sz] of [
    [-2.56, -1.55],
    [-2.56, -0.35],
    [2.56, -1.55],
    [2.56, -0.35],
  ] as const) {
    addCylinder(root, woodDark, sx, sz, [0, 0.045], 0.2);
    addCylinder(root, woodDark, sx, sz, [0.045, 0.29], 0.055);
    addCylinder(
      root,
      materials.material("#93583a", { roughness: 0.76 }),
      sx,
      sz,
      [0.29, 0.34],
      0.22,
    );
  }

  // 左右两张单柱圆桌 + 咖啡杯碟与烛光/花瓶
  const tableTop = 0.39;
  for (const [tx, tz, hasCandle] of [
    [-4.1, -1.2, true],
    [4.1, -1.0, false],
  ] as const) {
    addCylinder(root, woodDark, tx, tz, [0, 0.05], 0.26);
    addCylinder(root, woodDark, tx, tz, [0.05, tableTop - 0.06], 0.07);
    addCylinder(root, honey, tx, tz, [tableTop - 0.06, tableTop], 0.52);
    addCylinder(root, porcelain, tx - 0.15, tz + 0.1, [tableTop, tableTop + 0.02], 0.13);
    addCylinder(root, porcelain, tx - 0.15, tz + 0.1, [tableTop + 0.02, tableTop + 0.14], 0.085);
    if (hasCandle) {
      addCylinder(root, cream, tx + 0.18, tz - 0.1, [tableTop, tableTop + 0.14], 0.048);
      addBox(
        root,
        candleFlameMaterial,
        [tx + 0.16, tx + 0.2],
        [tableTop + 0.14, tableTop + 0.22],
        [tz - 0.12, tz - 0.08],
        { cast: false, receive: false },
      );
    } else {
      addCylinder(root, sage, tx + 0.18, tz - 0.08, [tableTop, tableTop + 0.18], 0.058);
      addBlob(
        root,
        materials.material("#9b7cc8", { roughness: 0.78 }),
        [tx + 0.18, tableTop + 0.25, tz - 0.08],
        [0.08, 0.07, 0.08],
      );
    }
  }

  // 黑板下方矮书架 + 彩色藏书 + 黑胶唱片机 + 小台灯
  addBox(root, wood, [2.9, 4.42], [0, 0.9], [backZ, -3.28]);
  addBox(root, honey, [2.87, 4.45], [0.86, 0.91], [backZ, -3.25]);
  const bookMats = [azuki, cream, sage, kraft, matcha, terracotta];
  for (const [shelfIdx, sy] of [0.08, 0.48].entries()) {
    for (let i = 0; i < 8; i++) {
      const bx = 3.0 + i * 0.165;
      const bh = 0.25 + ((i + shelfIdx) % 3) * 0.04;
      addBox(
        root,
        bookMats[(i + shelfIdx * 2) % bookMats.length],
        [bx, bx + 0.125],
        [sy, sy + bh],
        [-3.68, -3.32],
      );
    }
  }
  // 黑胶唱片机
  addBox(root, woodDark, [3.05, 3.68], [0.91, 0.99], [-3.65, -3.3]);
  addCylinder(root, iron, 3.34, -3.48, [0.99, 1.015], 0.2);
  addCylinder(root, azuki, 3.34, -3.48, [1.015, 1.022], 0.065);
  addBox(root, brass, [3.55, 3.58], [0.99, 1.03], [-3.58, -3.36]);
  addDeskLamp(4.15, 0.91, -3.45, warmShadeMaterial, 0.78);

  // 左前方立式软木留言板
  for (const lx of [-5.02, -3.98]) {
    addBox(root, woodDark, [lx - 0.05, lx + 0.05], [0, 1.55], [2.06, 2.18]);
  }
  addBox(root, wood, [-5.08, -3.92], [0.64, 1.55], [2.08, 2.16]);
  addBox(
    root,
    materials.material("#c49a63", { roughness: 0.88 }),
    [-5.0, -4.0],
    [0.72, 1.47],
    [2.16, 2.175],
  );
  for (const [nx, ny, noteMat] of [
    [-4.76, 1.28, cream],
    [-4.42, 1.32, matcha],
    [-4.14, 1.2, porcelain],
    [-4.62, 0.94, porcelain],
    [-4.26, 0.95, cream],
  ] as const) {
    addBox(root, noteMat, [nx - 0.11, nx + 0.11], [ny - 0.11, ny + 0.11], [2.175, 2.19]);
  }

  // 三盆龟背竹大绿植（左窗旁、右后角、右前角）
  for (const [px, pz, s] of [
    [-2.52, -3.22, 0.88],
    [5.02, -3.15, 1.0],
    [5.05, 2.75, 1.0],
  ] as const) {
    addCylinder(root, terracotta, px, pz, [0, 0.42 * s], 0.25 * s);
    addCylinder(root, woodDark, px, pz, [0.38 * s, 0.44 * s], 0.27 * s);
    addBlob(root, leafDark, [px, 0.82 * s, pz], [0.38 * s, 0.42 * s, 0.34 * s]);
    addBlob(
      root,
      leafLight,
      [px - 0.13 * s, 1.14 * s, pz + 0.08 * s],
      [0.25 * s, 0.26 * s, 0.23 * s],
    );
    addBlob(
      root,
      leafLight,
      [px + 0.15 * s, 0.96 * s, pz - 0.06 * s],
      [0.22 * s, 0.21 * s, 0.2 * s],
    );
  }

  // 6 盏乳白玻璃自发光吊灯 + 细吊杆
  const pendantCoords: readonly [number, number, number][] = [
    [-1.7, 1.82, -1.5],
    [-1.7, 1.82, -0.4],
    [1.7, 1.82, -1.5],
    [1.7, 1.82, -0.4],
    [-4.1, 1.72, -1.2],
    [4.1, 1.72, -1.0],
  ];
  const pendantPositions: Vector3[] = [];
  for (const [lx, ly, lz] of pendantCoords) {
    addBox(
      root,
      woodDark,
      [lx - 0.016, lx + 0.016],
      [ly + 0.22, LIT_ROOM.wallHeight + 0.1],
      [lz - 0.016, lz + 0.016],
      { cast: false },
    );
    addCylinder(root, brass, lx, lz, [ly + 0.18, ly + 0.24], 0.055, { cast: false });
    const shade = new Mesh(pendantShadeGeo, warmShadeMaterial);
    shade.position.set(lx, ly + 0.08, lz);
    shade.castShadow = false;
    shade.receiveShadow = false;
    root.add(shade);
    pendantPositions.push(new Vector3(lx, ly + 0.02, lz));
  }

  const steamAnchors = [
    new Vector3(-0.52, top + 0.48, -3.2),
    new Vector3(-4.25, 0.82, -1.1),
    new Vector3(3.95, 0.82, -0.9),
  ];

  return {
    root,
    fanBlades,
    windowBackdropMaterial,
    kitchenPaperMaterial,
    accentShadeMaterial,
    pendantPositions,
    steamAnchors,
    dispose() {
      unitBox.dispose();
      unitCylinder.dispose();
      unitSphere.dispose();
      pendantShadeGeo.dispose();
      unitFloorPlane.dispose();
      unitStandee.dispose();
    },
  };
}
