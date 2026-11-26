import {
  type DataTexture,
  Group,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import type { LitMaterials } from "./lit-materials";
import type { LitTextures } from "./lit-textures";
import {
  addCashRegister,
  addEspressoMachine,
  addGrinder,
  addRecordCrate,
  addRecordPlayer,
} from "./props/appliances";
import {
  addArmchair,
  addBarStool,
  addBookRow,
  addChair,
  addHighStool,
  addRoundTable,
  addSquareTable,
  addWallBench,
} from "./props/furniture";
import { addCandle, addDeskLamp, addFloorLamp, addPendant, addWallSconce } from "./props/lamps";
import {
  addDriedFlowers,
  addFloorPlant,
  addKokedama,
  addSmallPlant,
  addTrailingPlant,
} from "./props/plants";
import { createPropKit, type Range } from "./props/prop-shapes";
import {
  addBeanBag,
  addBeanJar,
  addBowlStack,
  addBreadBasket,
  addBudVase,
  addCakeStand,
  addCupAndSaucer,
  addGooseneckKettle,
  addMilkPitcher,
  addMug,
  addPlateStack,
  addPot,
  addPourOverStand,
  addSiphon,
  addTeaCanister,
  addTetsubin,
} from "./props/vessels";

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** 1 屏幕像素对应的世界宽度（米），约 36 像素/米。 */
export const LIT_PIXEL = 0.028;
/** 铺满表面的贴图一个纹素的边长：2 个屏幕像素宽。 */
const TEXEL = 2 * LIT_PIXEL;

/**
 * 店面 8 米宽、6 米深。墙、门、家具统一按角色比例缩：角色约 1.8 头身、身高约 1.1 米，
 * 墙高 2.4 米，吧台台面 0.4 米，店门 1.75 米高。
 */
export const LIT_ROOM = {
  minX: -4,
  maxX: 4,
  minZ: -3,
  maxZ: 3,
  wallHeight: 2.4,
} as const;

const BAR_TOP = 0.4;
/** 吧台主段：和后墙平行，面向客区。 */
const BAR_MAIN = { minX: -1.6, maxX: 2.4, minZ: -1.6, maxZ: -1.1 } as const;
/** 吧台右端折回后墙的一段，和主段的转角处是收银台。 */
const BAR_TURN = { minX: 2.4, maxX: 2.95, minZ: -2.5, maxZ: -1.1 } as const;
/** 后墙操作台，后厨门左右各一段。 */
const WORKTOP_LEFT = { minX: -1.6, maxX: 0.1, minZ: LIT_ROOM.minZ, maxZ: -2.5 } as const;
const WORKTOP_RIGHT = { minX: 1.3, maxX: 2.95, minZ: LIT_ROOM.minZ, maxZ: -2.5 } as const;
/** 后厨推拉门在后墙上的左右范围。 */
const KITCHEN_DOOR: Range = [0.2, 1.2];
/** 腰门：吧台主段左端到后墙操作台之间，吧台内外唯一的通道。 */
const GATE = { x: -1.6, minZ: WORKTOP_LEFT.maxZ, maxZ: BAR_MAIN.minZ } as const;
/** 吧台凳的 x 坐标，凳子中心离吧台外沿 0.36 米。 */
const STOOL_X = [-1.05, -0.05, 0.95, 1.95] as const;
const STOOL_Z = BAR_MAIN.maxZ + 0.36;
/** 店门在前墙上的左右范围，高 1.75 米。 */
const SHOP_DOOR: Range = [1.5, 2.4];
const DOOR_HEIGHT = 1.75;
/** 障子窗：左墙长椅上方两扇，前墙窗边吧台上方一扇。u 是沿墙的坐标。 */
const LEFT_WINDOWS: readonly Range[] = [
  [-1.95, -0.95],
  [-0.35, 0.65],
];
const FRONT_WINDOW: Range = [-3.4, -1.6];
const WINDOW_Y: Range = [0.85, 1.85];

const BENCH = { minX: LIT_ROOM.minX, maxX: -3.5, minZ: -2.2, maxZ: 0.9 } as const;
const BENCH_TABLE_Z = [-1.45, 0.15] as const;
const BENCH_TABLE = { x: -3.17, width: 0.5, depth: 0.55, top: 0.34 } as const;
const BENCH_CHAIR_X = -2.55;
const CENTER_TABLE = { x: 0.6, z: 1.0, radius: 0.32, top: 0.36 } as const;
const CENTER_CHAIR_X = [0.05, 1.15] as const;
const WINDOW_COUNTER = {
  minX: -3.6,
  maxX: -1.4,
  minZ: 2.65,
  maxZ: LIT_ROOM.maxZ,
  top: 0.42,
} as const;
const WINDOW_STOOL_X = [-3.0, -2.0] as const;
const WINDOW_STOOL_Z = 2.35;
const LOW_BOOKCASE = {
  minX: 3.05,
  maxX: 3.95,
  minZ: LIT_ROOM.minZ,
  maxZ: -2.65,
  top: 0.8,
} as const;
const ARMCHAIR = { x: 3.5, z: -1.85 } as const;
const FLOOR_LAMP = { x: 3.8, z: -2.42 } as const;
const DISPLAY_SHELF = { minZ: -0.9, maxZ: 1.1, depth: 0.38 } as const;
const DISPLAY_CRATE = {
  minX: 2.65,
  maxX: 3.25,
  minZ: 2.65,
  maxZ: LIT_ROOM.maxZ,
  top: 0.45,
} as const;
const UMBRELLA_STAND = { x: 1.0, z: 2.8 } as const;
const PLANTS = [
  { x: -3.6, z: -2.6, scale: 0.9 },
  { x: -3.65, z: 1.45, scale: 0.7 },
  { x: 3.6, z: 2.6, scale: 0.85 },
] as const;

export const LIT_WALKABLE = { minX: -3.75, maxX: 3.75, minZ: -2.75, maxZ: 2.75 } as const;
export const LIT_CUSTOMER_RADIUS = 0.24;

/**
 * 走不过去的家具，按外沿算。吧台主段、折回段和后墙操作台围出店员区，后厨门前留空；
 * 腰门不挡：现在键盘操作的就是店员本人，她可以从腰门进出。凳子不挡，人可以从旁边挤过去。
 */
export const LIT_OBSTACLES: readonly Rect[] = [
  BAR_MAIN,
  BAR_TURN,
  WORKTOP_LEFT,
  WORKTOP_RIGHT,
  BENCH,
  ...BENCH_TABLE_Z.map((z) => ({
    minX: BENCH_TABLE.x - BENCH_TABLE.width / 2,
    maxX: BENCH_TABLE.x + BENCH_TABLE.width / 2,
    minZ: z - BENCH_TABLE.depth / 2,
    maxZ: z + BENCH_TABLE.depth / 2,
  })),
  ...BENCH_TABLE_Z.map((z) => ({
    minX: BENCH_CHAIR_X - 0.2,
    maxX: BENCH_CHAIR_X + 0.2,
    minZ: z - 0.18,
    maxZ: z + 0.18,
  })),
  {
    minX: CENTER_TABLE.x - CENTER_TABLE.radius,
    maxX: CENTER_TABLE.x + CENTER_TABLE.radius,
    minZ: CENTER_TABLE.z - CENTER_TABLE.radius,
    maxZ: CENTER_TABLE.z + CENTER_TABLE.radius,
  },
  ...CENTER_CHAIR_X.map((x) => ({
    minX: x - 0.2,
    maxX: x + 0.2,
    minZ: CENTER_TABLE.z - 0.18,
    maxZ: CENTER_TABLE.z + 0.18,
  })),
  WINDOW_COUNTER,
  LOW_BOOKCASE,
  {
    minX: ARMCHAIR.x - 0.31,
    maxX: ARMCHAIR.x + 0.31,
    minZ: ARMCHAIR.z - 0.28,
    maxZ: ARMCHAIR.z + 0.28,
  },
  {
    minX: FLOOR_LAMP.x - 0.14,
    maxX: FLOOR_LAMP.x + 0.14,
    minZ: FLOOR_LAMP.z - 0.14,
    maxZ: FLOOR_LAMP.z + 0.14,
  },
  {
    minX: LIT_ROOM.maxX - DISPLAY_SHELF.depth,
    maxX: LIT_ROOM.maxX,
    minZ: DISPLAY_SHELF.minZ,
    maxZ: DISPLAY_SHELF.maxZ,
  },
  DISPLAY_CRATE,
  {
    minX: UMBRELLA_STAND.x - 0.12,
    maxX: UMBRELLA_STAND.x + 0.12,
    minZ: UMBRELLA_STAND.z - 0.12,
    maxZ: UMBRELLA_STAND.z + 0.12,
  },
  ...PLANTS.map((plant) => ({
    minX: plant.x - 0.3 * plant.scale,
    maxX: plant.x + 0.3 * plant.scale,
    minZ: plant.z - 0.3 * plant.scale,
    maxZ: plant.z + 0.3 * plant.scale,
  })),
].map((rect) => ({
  minX: rect.minX - 0.04,
  maxX: rect.maxX + 0.04,
  minZ: rect.minZ - 0.04,
  maxZ: rect.maxZ + 0.04,
}));

/** 店的四面墙。 */
export type LitWallSide = "back" | "left" | "right" | "front";
const WALL_SIDES: readonly LitWallSide[] = ["back", "left", "right", "front"];
/** 离开墙面、朝店里的水平方向（x, z）。 */
const WALL_INWARD: Record<LitWallSide, readonly [number, number]> = {
  back: [0, 1],
  front: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

export type LitCafeHandles = {
  root: Group;
  /** 障子窗的纸面：随调光参数改颜色和亮度。 */
  windowBackdropMaterial: MeshStandardMaterial;
  /** 左墙两扇障子窗的洞口，窗光的光柱从这里照进来。 */
  sunWindows: { z: Range; y: Range }[];
  pendantPositions: Vector3[];
  steamAnchors: Vector3[];
  cutAwayWalls: (near: readonly LitWallSide[]) => void;
  dispose: () => void;
};

/**
 * 日式喫茶店：建筑、家具、器皿和自发光灯具全部由 3D 几何体搭成，投射并接收阴影。
 * 这里负责布局：墙、地面、吧台，并把 props/ 里的道具摆到位置上。
 * 布局和每面墙的分工见 coverage/咖啡馆交互/场景美术.md。
 */
export function buildLitCafe(textures: LitTextures, materials: LitMaterials): LitCafeHandles {
  const root = new Group();
  const kit = createPropKit(materials);
  const { box } = kit;
  const p = kit.palette;
  const unitFloorPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const addFloorPatch = (mat: Material, [x0, x1]: Range, [z0, z1]: Range, y: number) => {
    const mesh = new Mesh(unitFloorPlane, mat);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.scale.set(x1 - x0, 1, z1 - z0);
    mesh.receiveShadow = true;
    root.add(mesh);
  };

  // --- 建筑材质：铺满表面的按世界坐标贴，图案贴图按物体 UV 贴 ---
  const woodFloor = materials.worldMaterial(textures.woodFloorColor, TEXEL, 0.72);
  const barFloor = materials.worldMaterial(textures.barFloorColor, TEXEL, 0.74);
  const doma = materials.worldMaterial(textures.domaColor, TEXEL, 0.9);
  const woodSlats = materials.worldMaterial(textures.woodSlatsColor, TEXEL, 0.82);
  const honey = materials.worldMaterial(textures.honeyWoodColor, TEXEL, 0.54);
  const wallMat = materials.worldMaterial(textures.creamWallColor, TEXEL, 0.9);
  const chalkboard = materials.material("#ffffff", {
    map: textures.chalkboardColor,
    roughness: 0.88,
  });
  const painting = materials.material("#ffffff", { map: textures.paintingWarm, roughness: 0.82 });
  const windowBackdropMaterial = materials.material("#ffe6b3", {
    emissive: "#ffe09e",
    emissiveIntensity: 2.25,
    roughness: 1,
  });
  const kitchenPaper = materials.material("#f5eedc", {
    emissive: "#ffa84d",
    emissiveIntensity: 0.95,
    roughness: 0.9,
  });
  const frostedGlass = materials.material("#f3e6cc", {
    emissive: "#ffcf8a",
    emissiveIntensity: 0.35,
    roughness: 0.6,
  });
  const wallShadow = materials.shadowOnly();
  const noShadow = { cast: false, receive: false };

  // --- 墙 ---
  // 四面墙各自一组，挂在墙上的窗、门、置物架、黑板跟着墙放在同一组。
  // 转动视角时，挡在镜头前面的墙整组藏起来，换成一道贴地的木收边。
  const walls = Object.fromEntries(WALL_SIDES.map((side) => [side, new Group()])) as Record<
    LitWallSide,
    Group
  >;
  const wallTrims = Object.fromEntries(WALL_SIDES.map((side) => [side, new Group()])) as Record<
    LitWallSide,
    Group
  >;
  for (const side of WALL_SIDES) {
    wallTrims[side].visible = false;
    root.add(walls[side], wallTrims[side]);
  }

  /** 墙面坐标换成世界坐标：u 沿墙（前后墙是 x，左右墙是 z），d 从墙的内表面往店里量。 */
  const wallPoint = (side: LitWallSide, u: number, d: number): [number, number] => {
    switch (side) {
      case "back":
        return [u, LIT_ROOM.minZ + d];
      case "front":
        return [u, LIT_ROOM.maxZ - d];
      case "left":
        return [LIT_ROOM.minX + d, u];
      case "right":
        return [LIT_ROOM.maxX - d, u];
    }
  };

  /** 在墙面坐标里摆一个方块，放进这面墙的组，跟着墙一起藏。d 为负是墙体里面。 */
  const onWall = (
    side: LitWallSide,
    mat: Material,
    [u0, u1]: Range,
    y: Range,
    [d0, d1]: Range,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) => {
    const [ax, az] = wallPoint(side, u0, d0);
    const [bx, bz] = wallPoint(side, u1, d1);
    box(
      walls[side],
      mat,
      [Math.min(ax, bx), Math.max(ax, bx)],
      y,
      [Math.min(az, bz), Math.max(az, bz)],
      shadow,
    );
  };
  /**
   * 墙体和窗格：画面上的那份跟着墙藏、不投影子，另放一份只投影子的替身在根节点上。
   * 藏起来的物体不再挡光，没有替身的话，转到哪面墙被藏，窗光就从那面墙整片照进来。
   */
  const wallShell = (side: LitWallSide, mat: Material, u: Range, y: Range, d: Range) => {
    onWall(side, mat, u, y, d, { cast: false, receive: true });
    const [ax, az] = wallPoint(side, u[0], d[0]);
    const [bx, bz] = wallPoint(side, u[1], d[1]);
    box(
      root,
      wallShadow,
      [Math.min(ax, bx), Math.max(ax, bx)],
      y,
      [Math.min(az, bz), Math.max(az, bz)],
      { cast: true, receive: false },
    );
  };

  // 墙面下半截是竖条木护墙板，0.8 米处一道木腰线，上面是奶油色墙面，底下踢脚线，顶上一道木压顶。
  const WAINSCOT = 0.8;
  const wallPiece = (side: LitWallSide, u: Range, [y0, y1]: Range) => {
    if (y0 < WAINSCOT) {
      wallShell(side, woodSlats, u, [y0, Math.min(y1, WAINSCOT)], [-0.14, 0]);
    }
    if (y1 > WAINSCOT) {
      wallShell(side, wallMat, u, [Math.max(y0, WAINSCOT), y1], [-0.14, 0]);
    }
  };
  /** 一整面墙，openings 是窗洞（按 u 从小到大），窗洞让窗光透进来。 */
  const buildWall = (side: LitWallSide, [uMin, uMax]: Range, openings: readonly Range[]) => {
    let u = uMin;
    for (const opening of openings) {
      wallPiece(side, [u, opening[0]], [0, LIT_ROOM.wallHeight]);
      wallPiece(side, opening, [0, WINDOW_Y[0]]);
      wallPiece(side, opening, [WINDOW_Y[1], LIT_ROOM.wallHeight]);
      u = opening[1];
    }
    wallPiece(side, [u, uMax], [0, LIT_ROOM.wallHeight]);
    onWall(side, p.woodDark, [uMin, uMax], [WAINSCOT, WAINSCOT + 0.05], [-0.14, 0.03]);
    onWall(side, p.woodDark, [uMin, uMax], [0, 0.08], [-0.14, 0.02]);
    onWall(
      side,
      p.woodDark,
      [uMin - 0.14, uMax + 0.14],
      [LIT_ROOM.wallHeight, LIT_ROOM.wallHeight + 0.1],
      [-0.18, 0.04],
    );
    const [ax, az] = wallPoint(side, uMin - 0.14, -0.14);
    const [bx, bz] = wallPoint(side, uMax + 0.14, 0);
    box(
      wallTrims[side],
      p.woodDark,
      [Math.min(ax, bx), Math.max(ax, bx)],
      [-0.16, 0.01],
      [Math.min(az, bz), Math.max(az, bz)],
      { cast: false, receive: true },
    );
  };
  buildWall("back", [LIT_ROOM.minX - 0.14, LIT_ROOM.maxX + 0.14], []);
  buildWall("front", [LIT_ROOM.minX - 0.14, LIT_ROOM.maxX + 0.14], [FRONT_WINDOW]);
  buildWall("left", [LIT_ROOM.minZ, LIT_ROOM.maxZ], LEFT_WINDOWS);
  buildWall("right", [LIT_ROOM.minZ, LIT_ROOM.maxZ], []);
  // 店不做天花板，镜头从上方看进来；但窗光是从高处斜照的，没有顶就会越过墙头照满整个店。
  // 放一块只投影子的顶板，窗光只能从窗洞照进来。
  box(
    root,
    wallShadow,
    [LIT_ROOM.minX - 0.3, LIT_ROOM.maxX + 0.3],
    [LIT_ROOM.wallHeight, LIT_ROOM.wallHeight + 0.1],
    [LIT_ROOM.minZ - 0.3, LIT_ROOM.maxZ + 0.3],
    { cast: true, receive: false },
  );

  /** 障子窗：窗洞里一层发光的纸，室内一侧压着木格子，窗台挑出一点。 */
  const addShoji = (side: LitWallSide, [u0, u1]: Range) => {
    const [y0, y1] = WINDOW_Y;
    onWall(side, windowBackdropMaterial, [u0, u1], [y0, y1], [-0.1, -0.07], noShadow);
    wallShell(side, p.woodDark, [u0 - 0.06, u1 + 0.06], [y0 - 0.06, y0], [-0.14, 0.08]);
    wallShell(side, p.woodDark, [u0 - 0.06, u1 + 0.06], [y1, y1 + 0.06], [-0.14, 0.04]);
    wallShell(side, p.woodDark, [u0 - 0.06, u0], [y0, y1], [-0.14, 0.04]);
    wallShell(side, p.woodDark, [u1, u1 + 0.06], [y0, y1], [-0.14, 0.04]);
    const columns = Math.round((u1 - u0) / 0.2);
    for (let i = 1; i < columns; i++) {
      const u = u0 + ((u1 - u0) * i) / columns;
      wallShell(side, p.wood, [u - 0.016, u + 0.016], [y0, y1], [-0.07, -0.03]);
    }
    for (let i = 1; i < 4; i++) {
      const y = y0 + ((y1 - y0) * i) / 4;
      wallShell(side, p.wood, [u0, u1], [y - 0.016, y + 0.016], [-0.07, -0.03]);
    }
  };
  for (const window of LEFT_WINDOWS) {
    addShoji("left", window);
  }
  addShoji("front", FRONT_WINDOW);

  // --- 地面：客区木地板，吧台内深一档的木地板，门口石砖土間，两块地毯 ---
  box(root, woodFloor, [LIT_ROOM.minX, LIT_ROOM.maxX], [-0.16, 0], [LIT_ROOM.minZ, LIT_ROOM.maxZ], {
    cast: false,
    receive: true,
  });
  addFloorPatch(barFloor, [BAR_MAIN.minX, BAR_TURN.maxX], [LIT_ROOM.minZ, BAR_MAIN.maxZ], 0.003);
  addFloorPatch(doma, [1.15, 2.75], [2.3, LIT_ROOM.maxZ], 0.003);
  addFloorPatch(materials.material("#7d583a", { roughness: 0.95 }), [1.6, 2.3], [2.4, 2.85], 0.006);
  const rugSize = (texture: DataTexture) => [
    texture.image.width * TEXEL,
    texture.image.height * TEXEL,
  ];
  const [rugW, rugD] = rugSize(textures.rugColor);
  addFloorPatch(
    materials.material("#ffffff", { map: textures.rugColor, roughness: 0.95 }),
    [CENTER_TABLE.x - rugW / 2, CENTER_TABLE.x + rugW / 2],
    [CENTER_TABLE.z - rugD / 2, CENTER_TABLE.z + rugD / 2],
    0.006,
  );
  const [benchRugW, benchRugD] = rugSize(textures.benchRugColor);
  addFloorPatch(
    materials.material("#ffffff", { map: textures.benchRugColor, roughness: 0.95 }),
    [BENCH.maxX, BENCH.maxX + benchRugW],
    [-0.65 - benchRugD / 2, -0.65 + benchRugD / 2],
    0.006,
  );

  // ===== 后墙吧台内：操作台、顶天置物架、后厨门、黑板、唱片机 =====
  const top = BAR_TOP;
  for (const worktop of [WORKTOP_LEFT, WORKTOP_RIGHT]) {
    box(
      root,
      p.woodDark,
      [worktop.minX, worktop.maxX],
      [0, 0.06],
      [worktop.minZ, worktop.maxZ - 0.06],
    );
    box(
      root,
      woodSlats,
      [worktop.minX, worktop.maxX],
      [0.06, top - 0.1],
      [worktop.minZ, worktop.maxZ - 0.03],
    );
    box(
      root,
      p.woodDark,
      [worktop.minX, worktop.maxX],
      [top - 0.1, top - 0.06],
      [worktop.minZ, worktop.maxZ],
    );
    box(
      root,
      honey,
      [worktop.minX, worktop.maxX],
      [top - 0.06, top],
      [worktop.minZ, worktop.maxZ + 0.04],
    );
  }
  const leftZ = (WORKTOP_LEFT.minZ + WORKTOP_LEFT.maxZ) / 2;
  const rightZ = (WORKTOP_RIGHT.minZ + WORKTOP_RIGHT.maxZ) / 2;
  addEspressoMachine(kit, root, -1.0, top, leftZ - 0.03);
  addGrinder(kit, root, -0.38, top, leftZ);
  addMilkPitcher(kit, root, -0.1, top, leftZ + 0.08);
  addRecordPlayer(kit, root, 1.62, top, rightZ);
  addRecordCrate(kit, root, 2.17, top, rightZ - 0.02);
  addGooseneckKettle(kit, root, 2.55, top, rightZ + 0.04);
  addTeaCanister(kit, root, 2.82, top, rightZ - 0.08, p.azuki, p.cream);

  // 左段上方的顶天置物架：三层架板，每层手工排的器物，板下一条暖光灯带
  const shelfDepth = 0.3;
  const shelfZ = LIT_ROOM.minZ + shelfDepth / 2;
  const shelf = walls.back;
  const addBackShelf = ([x0, x1]: Range, y: number, depth: number) => {
    onWall("back", p.woodDark, [x0, x1], [y - 0.05, y], [0, depth]);
    onWall(
      "back",
      p.shelfStrip,
      [x0 + 0.06, x1 - 0.06],
      [y - 0.064, y - 0.05],
      [0.04, 0.08],
      noShadow,
    );
  };
  for (const y of [1.0, 1.42, 1.84]) {
    addBackShelf([WORKTOP_LEFT.minX, WORKTOP_LEFT.maxX], y, shelfDepth);
  }
  for (const x of [WORKTOP_LEFT.minX + 0.03, WORKTOP_LEFT.maxX - 0.03]) {
    onWall("back", p.woodDark, [x - 0.03, x + 0.03], [top, LIT_ROOM.wallHeight], [0, shelfDepth]);
  }
  // 第一层：豆罐、马克杯、碗
  addBeanJar(kit, shelf, -1.45, 1.0, shelfZ);
  addBeanJar(kit, shelf, -1.25, 1.0, shelfZ);
  addBeanJar(kit, shelf, -1.05, 1.0, shelfZ, 0.8);
  addMug(kit, shelf, -0.78, 1.0, shelfZ + 0.02, p.matcha, true);
  addMug(kit, shelf, -0.6, 1.0, shelfZ - 0.02, p.porcelain, true);
  addBowlStack(kit, shelf, -0.28, 1.0, shelfZ);
  // 第二层：书、座钟、茶筒、小盆栽
  addBookRow(kit, shelf, "x", -1.55, shelfZ, 1.42, 5, 3);
  box(shelf, p.wood, [-1.12, -0.94], [1.42, 1.66], [shelfZ - 0.08, shelfZ + 0.06]);
  kit.mesh(
    shelf,
    kit.lathe([
      [0, 0],
      [0.065, 0],
      [0.065, 0.012],
      [0, 0.012],
    ]),
    p.cream,
    { at: [-1.03, 1.57, shelfZ + 0.06], rotation: [Math.PI / 2, 0, 0] },
  );
  addTeaCanister(kit, shelf, -0.75, 1.42, shelfZ, p.matcha, p.cream);
  addTeaCanister(kit, shelf, -0.58, 1.42, shelfZ, p.azuki, p.kraft);
  addSmallPlant(kit, shelf, -0.25, 1.42, shelfZ, p.terracotta, 5);
  // 第三层：垂吊藤蔓、豆罐、相框
  addTrailingPlant(kit, shelf, -1.4, 1.84, shelfZ, WALL_INWARD.back, 2);
  addBeanJar(kit, shelf, -1.1, 1.84, shelfZ, 1.1);
  addBeanJar(kit, shelf, -0.88, 1.84, shelfZ, 0.9);
  box(shelf, p.woodDark, [-0.62, -0.42], [1.84, 2.1], [shelfZ - 0.04, shelfZ - 0.01]);
  box(shelf, p.cream, [-0.59, -0.45], [1.87, 2.07], [shelfZ - 0.01, shelfZ]);
  addTrailingPlant(kit, shelf, -0.2, 1.84, shelfZ, WALL_INWARD.back, 9);

  // 后厨推拉门：下半截木板，上半截木格压纸，透出厨房的暖光
  const [doorL, doorR] = KITCHEN_DOOR;
  onWall("back", p.woodDark, [doorL - 0.06, doorR + 0.06], [0, DOOR_HEIGHT + 0.06], [0, 0.04]);
  onWall("back", woodSlats, [doorL, doorR], [0.02, 0.7], [0.03, 0.07]);
  onWall(
    "back",
    kitchenPaper,
    [doorL + 0.04, doorR - 0.04],
    [0.74, DOOR_HEIGHT - 0.04],
    [0.04, 0.06],
    noShadow,
  );
  for (const u of [doorL + (doorR - doorL) / 3, doorL + ((doorR - doorL) * 2) / 3]) {
    onWall("back", p.wood, [u - 0.018, u + 0.018], [0.72, DOOR_HEIGHT], [0.05, 0.08]);
  }
  for (const y of [1.06, 1.4]) {
    onWall("back", p.wood, [doorL, doorR], [y - 0.018, y + 0.018], [0.05, 0.08]);
  }
  onWall("back", p.woodDark, [doorL, doorR], [0.68, 0.74], [0.04, 0.08]);
  onWall("back", p.brass, [doorR - 0.12, doorR - 0.08], [0.9, 1.0], [0.07, 0.09]);

  // 右段上方：黑板菜单、壁灯、一层墙搁板
  const boardW = textures.chalkboardColor.image.width * LIT_PIXEL;
  const boardH = textures.chalkboardColor.image.height * LIT_PIXEL;
  const boardX = 1.45;
  onWall(
    "back",
    p.woodDark,
    [boardX - 0.04, boardX + boardW + 0.04],
    [0.96, 1.04 + boardH],
    [0, 0.03],
  );
  onWall("back", chalkboard, [boardX, boardX + boardW], [1.0, 1.0 + boardH], [0.02, 0.05], {
    cast: false,
  });
  addWallSconce(kit, shelf, [boardX + boardW / 2, 1.62, LIT_ROOM.minZ + 0.02], WALL_INWARD.back);
  addBackShelf([WORKTOP_RIGHT.minX, WORKTOP_RIGHT.maxX], 1.95, 0.28);
  const upperZ = LIT_ROOM.minZ + 0.14;
  addSmallPlant(kit, shelf, 1.45, 1.95, upperZ, p.porcelain, 11);
  addBookRow(kit, shelf, "x", 1.65, upperZ, 1.95, 4, 8);
  addBeanJar(kit, shelf, 2.1, 1.95, upperZ);
  addBowlStack(kit, shelf, 2.38, 1.95, upperZ);
  addTrailingPlant(kit, shelf, 2.7, 1.95, upperZ, WALL_INWARD.back, 14);

  // 后厨门和右段上方一串小灯，每颗 2×2 像素
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x =
      Math.round((KITCHEN_DOOR[0] + t * (WORKTOP_RIGHT.maxX - KITCHEN_DOOR[0])) / LIT_PIXEL) *
      LIT_PIXEL;
    const y = 2.32 - Math.sin(t * Math.PI) * 0.1;
    onWall(
      "back",
      p.bulb,
      [x - LIT_PIXEL, x + LIT_PIXEL],
      [y - LIT_PIXEL, y + LIT_PIXEL],
      [0.04, 0.1],
      noShadow,
    );
  }

  // ===== 吧台：主段加右端折回段，左端腰门 =====
  for (const part of [BAR_MAIN, BAR_TURN]) {
    box(
      root,
      p.woodDark,
      [part.minX + 0.05, part.maxX - 0.05],
      [0, 0.08],
      [part.minZ + 0.05, part.maxZ - 0.05],
    );
    box(root, woodSlats, [part.minX, part.maxX], [0.08, top - 0.1], [part.minZ, part.maxZ]);
    box(
      root,
      p.woodDark,
      [part.minX - 0.01, part.maxX + 0.01],
      [top - 0.1, top - 0.06],
      [part.minZ - 0.01, part.maxZ + 0.01],
    );
    box(
      root,
      honey,
      [part.minX - 0.04, part.maxX + 0.04],
      [top - 0.06, top],
      [part.minZ - 0.04, part.maxZ + 0.04],
    );
  }
  for (const [x, z] of [
    [BAR_MAIN.minX, BAR_MAIN.maxZ],
    [BAR_TURN.maxX, BAR_TURN.maxZ],
  ] as const) {
    box(root, p.woodDark, [x - 0.06, x + 0.06], [0, top + 0.03], [z - 0.06, z + 0.06]);
  }
  // 腰门：下半截木板，上半截疏朗的木栅，顶上一条台面同色的压顶，门轴一侧两枚黄铜合页
  box(
    root,
    woodSlats,
    [GATE.x - 0.04, GATE.x + 0.04],
    [0.04, 0.22],
    [GATE.minZ + 0.04, GATE.maxZ - 0.04],
  );
  for (let i = 0; i <= 5; i++) {
    const z = GATE.minZ + 0.06 + (i * (GATE.maxZ - GATE.minZ - 0.12)) / 5;
    box(root, p.wood, [GATE.x - 0.02, GATE.x + 0.02], [0.22, top - 0.04], [z - 0.02, z + 0.02]);
  }
  box(
    root,
    honey,
    [GATE.x - 0.05, GATE.x + 0.05],
    [top - 0.05, top],
    [GATE.minZ + 0.02, GATE.maxZ - 0.02],
  );
  for (const y of [0.1, 0.3]) {
    box(
      root,
      p.brass,
      [GATE.x - 0.05, GATE.x + 0.05],
      [y, y + 0.04],
      [GATE.minZ + 0.02, GATE.minZ + 0.05],
    );
  }

  // 吧台台面：手冲架、蛋糕、虹吸壶、小碟、面包篮、蜡烛、一轮插；第二张凳子前一杯刚做好的咖啡
  const innerZ = BAR_MAIN.minZ + 0.16;
  addPourOverStand(kit, root, -1.35, top, innerZ);
  addCakeStand(kit, root, -0.55, top, innerZ + 0.06);
  addSiphon(kit, root, 0.32, top, innerZ);
  addSiphon(kit, root, 0.58, top, innerZ + 0.04);
  addPlateStack(kit, root, 0.95, top, innerZ, 4);
  addBreadBasket(kit, root, 1.45, top, innerZ + 0.04);
  addCandle(kit, root, 1.78, top, BAR_MAIN.maxZ - 0.14);
  addBudVase(kit, root, 2.15, top, innerZ, p.sage, p.violet);
  addCupAndSaucer(kit, root, STOOL_X[1], top, BAR_MAIN.maxZ - 0.14);
  // 收银台：转角上的收银机、折回段上的台灯
  addCashRegister(kit, root, 2.68, top, BAR_MAIN.minZ + 0.25);
  addDeskLamp(kit, root, 2.68, top, -2.05, 0.9);

  for (const x of STOOL_X) {
    addBarStool(kit, root, x, STOOL_Z, 0.32);
  }

  // ===== 吊灯：吧台外沿三盏，长椅角两张小桌上方各一盏 =====
  // 吊线从墙顶高度垂下来，在画面上是一条竖线，会划过它后方的东西，所以吊灯只挂在不挡人的地方：
  // 吧台的灯挂在台面外沿、顾客一侧，30° 俯视下灯罩和吊线都落在店员头顶以上；小桌的灯贴着左墙。
  // 中间的小圆桌不挂吊灯，用台灯。
  const pendantCoords: readonly [number, number, number][] = [
    [-0.55, 1.9, BAR_MAIN.maxZ + 0.1],
    [0.45, 1.9, BAR_MAIN.maxZ + 0.1],
    [1.45, 1.9, BAR_MAIN.maxZ + 0.1],
    [BENCH_TABLE.x, 1.38, BENCH_TABLE_Z[0]],
    [BENCH_TABLE.x, 1.38, BENCH_TABLE_Z[1]],
  ];
  const pendantPositions: Vector3[] = [];
  for (const [x, y, z] of pendantCoords) {
    addPendant(kit, root, x, y, z, LIT_ROOM.wallHeight + 0.1);
    pendantPositions.push(new Vector3(x, y, z));
  }

  // ===== 后墙吧台外：左角大绿植和干花、挂画；右角阅读角 =====
  addFloorPlant(kit, root, PLANTS[0].x, PLANTS[0].z, PLANTS[0].scale, 1);
  for (const [i, [x, bloom]] of (
    [
      [-3.05, p.azuki],
      [-2.75, p.violet],
      [-2.45, p.cream],
    ] as const
  ).entries()) {
    addDriedFlowers(kit, walls.back, [x, 2.05, LIT_ROOM.minZ], WALL_INWARD.back, bloom, i * 3);
  }
  const paintW = textures.paintingWarm.image.width * LIT_PIXEL;
  const paintH = textures.paintingWarm.image.height * LIT_PIXEL;
  const addPainting = (side: LitWallSide, u: number, y: number) => {
    onWall(
      side,
      p.woodDark,
      [u - 0.03, u + paintW + 0.03],
      [y - 0.03, y + paintH + 0.03],
      [0, 0.03],
    );
    onWall(side, painting, [u, u + paintW], [y, y + paintH], [0.02, 0.045], { cast: false });
  };
  addPainting("back", -2.6, 1.15);

  const bc = LOW_BOOKCASE;
  const bookZ = (bc.minZ + bc.maxZ) / 2;
  box(root, p.wood, [bc.minX, bc.maxX], [0, 0.05], [bc.minZ, bc.maxZ]);
  for (const x of [bc.minX, bc.maxX - 0.03]) {
    box(root, p.wood, [x, x + 0.03], [0, bc.top], [bc.minZ, bc.maxZ]);
  }
  box(root, p.wood, [bc.minX, bc.maxX], [0.4, 0.43], [bc.minZ, bc.maxZ]);
  box(root, p.woodDark, [bc.minX, bc.maxX], [0.05, bc.top], [bc.minZ, bc.minZ + 0.02]);
  kit.mesh(
    root,
    kit.roundedBox(bc.maxX - bc.minX + 0.04, 0.035, bc.maxZ - bc.minZ + 0.03, 0.01),
    p.honey,
    {
      at: [(bc.minX + bc.maxX) / 2, bc.top + 0.017, bookZ],
    },
  );
  addBookRow(kit, root, "x", bc.minX + 0.05, bookZ, 0.05, 9, 21);
  addBookRow(kit, root, "x", bc.minX + 0.05, bookZ, 0.43, 6, 34);
  kit.mesh(root, kit.roundedBox(0.24, 0.16, 0.22, 0.03), p.kraft, {
    at: [bc.maxX - 0.18, 0.51, bookZ],
  });
  box(root, p.woodDark, [3.15, 3.36], [bc.top + 0.035, bc.top + 0.24], [bookZ - 0.03, bookZ]);
  box(root, p.cream, [3.18, 3.33], [bc.top + 0.06, bc.top + 0.21], [bookZ, bookZ + 0.004]);
  addBudVase(kit, root, 3.55, bc.top + 0.035, bookZ, p.terracotta, p.blush);
  addCandle(kit, root, 3.8, bc.top + 0.035, bookZ);
  addPainting("back", 3.2, 1.3);
  addArmchair(kit, root, ARMCHAIR.x, ARMCHAIR.z, 0);
  addFloorLamp(kit, root, FLOOR_LAMP.x, FLOOR_LAMP.z, 1.35);

  // ===== 左墙：障子窗下的长椅角 =====
  addWallBench(
    kit,
    root,
    [BENCH.minX, BENCH.maxX],
    [BENCH.minZ, BENCH.maxZ],
    [p.matcha, p.azuki, p.matcha, p.azuki],
  );
  for (const z of BENCH_TABLE_Z) {
    addSquareTable(
      kit,
      root,
      BENCH_TABLE.x,
      z,
      BENCH_TABLE.width,
      BENCH_TABLE.depth,
      BENCH_TABLE.top,
    );
    addChair(kit, root, BENCH_CHAIR_X, z, -Math.PI / 2, p.sage);
  }
  const [t0, t1] = BENCH_TABLE_Z;
  addCupAndSaucer(kit, root, BENCH_TABLE.x + 0.08, BENCH_TABLE.top, t0 + 0.08);
  addCandle(kit, root, BENCH_TABLE.x - 0.12, BENCH_TABLE.top, t0 - 0.14);
  addBudVase(kit, root, BENCH_TABLE.x - 0.1, BENCH_TABLE.top, t1 - 0.12, p.porcelain, p.azuki);
  addKokedama(kit, root, BENCH_TABLE.x + 0.1, BENCH_TABLE.top, t1 + 0.1);
  addDriedFlowers(kit, walls.left, [LIT_ROOM.minX, 2.1, -0.65], WALL_INWARD.left, p.violet, 7);
  addDriedFlowers(kit, walls.left, [LIT_ROOM.minX, 2.1, 1.0], WALL_INWARD.left, p.blush, 11);
  addFloorPlant(kit, root, PLANTS[1].x, PLANTS[1].z, PLANTS[1].scale, 4);

  // ===== 中间：小圆桌和两把椅子 =====
  addRoundTable(kit, root, CENTER_TABLE.x, CENTER_TABLE.z, CENTER_TABLE.radius, CENTER_TABLE.top);
  addChair(kit, root, CENTER_CHAIR_X[0], CENTER_TABLE.z, Math.PI / 2, p.azuki);
  addChair(kit, root, CENTER_CHAIR_X[1], CENTER_TABLE.z, -Math.PI / 2, p.matcha);
  addCupAndSaucer(kit, root, CENTER_TABLE.x - 0.14, CENTER_TABLE.top, CENTER_TABLE.z + 0.04);
  addDeskLamp(kit, root, CENTER_TABLE.x + 0.12, CENTER_TABLE.top, CENTER_TABLE.z - 0.1, 0.65);

  // ===== 右墙：顶天陈列架（出售的豆袋、汤吞杯、茶筒、陶器、苔玉） =====
  const ds = DISPLAY_SHELF;
  const dsX = LIT_ROOM.maxX - ds.depth / 2;
  const display = walls.right;
  onWall("right", p.wood, [ds.minZ, ds.maxZ], [0, 0.1], [0, ds.depth]);
  for (const z of [ds.minZ, ds.maxZ]) {
    onWall("right", p.woodDark, [z - 0.03, z + 0.03], [0, 2.05], [0, ds.depth]);
  }
  for (const y of [0.55, 1.0, 1.45, 1.9]) {
    onWall("right", p.woodDark, [ds.minZ, ds.maxZ], [y - 0.04, y], [0, ds.depth]);
    onWall(
      "right",
      p.shelfStrip,
      [ds.minZ + 0.06, ds.maxZ - 0.06],
      [y - 0.054, y - 0.04],
      [0.04, 0.08],
      noShadow,
    );
  }
  for (let i = 0; i < 6; i++) {
    addBeanBag(
      kit,
      display,
      dsX,
      0.1,
      ds.minZ + 0.2 + i * 0.32,
      "-x",
      i % 2 === 0 ? p.cream : p.matcha,
    );
  }
  for (let i = 0; i < 6; i++) {
    addMug(
      kit,
      display,
      dsX,
      0.55,
      ds.minZ + 0.18 + i * 0.32,
      [p.porcelain, p.sage, p.azuki][i % 3],
      false,
    );
  }
  for (let i = 0; i < 4; i++) {
    addTeaCanister(
      kit,
      display,
      dsX,
      1.0,
      ds.minZ + 0.25 + i * 0.5,
      [p.azuki, p.matcha][i % 2],
      p.cream,
    );
  }
  addKokedama(kit, display, dsX, 1.45, ds.minZ + 0.3);
  addBowlStack(kit, display, dsX, 1.45, ds.minZ + 0.75);
  addPot(kit, display, dsX, 1.45, ds.minZ + 1.2, 0.08, 0.16, p.sage);
  addBowlStack(kit, display, dsX, 1.45, ds.minZ + 1.65);
  addTrailingPlant(kit, display, dsX, 1.9, ds.minZ + 0.25, WALL_INWARD.right, 17);
  addBookRow(kit, display, "z", ds.minZ + 0.55, dsX, 1.9, 6, 44);
  addTrailingPlant(kit, display, dsX, 1.9, ds.maxZ - 0.3, WALL_INWARD.right, 23);
  addPainting("right", 1.6, 1.2);
  addWallSconce(kit, walls.right, [LIT_ROOM.maxX, 1.55, -1.85], WALL_INWARD.right);

  // ===== 前墙：店门、土間、挂衣钩和伞架、陈列箱、窗边吧台 =====
  const [shopL, shopR] = SHOP_DOOR;
  const shopMid = (shopL + shopR) / 2;
  onWall("front", p.woodDark, [shopL - 0.07, shopR + 0.07], [0, DOOR_HEIGHT + 0.07], [0, 0.04]);
  onWall("front", p.wood, [shopL, shopR], [0, DOOR_HEIGHT], [0.03, 0.08]);
  onWall("front", frostedGlass, [shopL + 0.18, shopR - 0.18], [1.25, 1.58], [0.07, 0.09], noShadow);
  onWall("front", p.woodDark, [shopMid - 0.015, shopMid + 0.015], [1.25, 1.58], [0.08, 0.1]);
  onWall("front", p.woodDark, [shopL + 0.12, shopR - 0.12], [0.16, 0.95], [0.07, 0.09]);
  onWall("front", p.wood, [shopL + 0.16, shopR - 0.16], [0.2, 0.91], [0.08, 0.1]);
  onWall("front", p.brass, [shopL + 0.07, shopL + 0.12], [0.82, 0.96], [0.08, 0.14]);
  // 门上挂着营业牌，两根细绳吊在门上的钉子上
  const [signX, signZ] = wallPoint("front", shopMid, 0.1);
  kit.rod(walls.front, p.kraft, [signX - 0.12, 1.22, signZ], [signX, 1.32, signZ], 0.004);
  kit.rod(walls.front, p.kraft, [signX + 0.12, 1.22, signZ], [signX, 1.32, signZ], 0.004);
  onWall("front", p.cream, [shopMid - 0.15, shopMid + 0.15], [1.06, 1.22], [0.09, 0.11]);
  onWall("front", p.azuki, [shopMid - 0.1, shopMid + 0.1], [1.12, 1.16], [0.11, 0.114], noShadow);

  // 挂衣钩：一条木板上三只黄铜钩，挂着一条围巾和一只布包
  onWall("front", p.woodDark, [0.15, 0.95], [1.4, 1.46], [0, 0.04]);
  for (const u of [0.3, 0.55, 0.8]) {
    const [hx, hz] = wallPoint("front", u, 0.04);
    kit.rod(walls.front, p.brass, [hx, 1.42, hz], [hx, 1.38, hz - 0.08], 0.01);
  }
  onWall("front", p.azuki, [0.48, 0.62], [0.95, 1.38], [0.06, 0.12]);
  onWall("front", p.kraft, [0.72, 0.9], [1.2, 1.38], [0.06, 0.16]);
  // 伞架和两把伞
  kit.mesh(
    root,
    kit.lathe([
      [0, 0],
      [0.1, 0],
      [0.12, 0.36],
      [0.115, 0.38],
      [0, 0.37],
    ]),
    p.woodDark,
    { at: [UMBRELLA_STAND.x, 0, UMBRELLA_STAND.z] },
  );
  for (const [dx, dz, mat] of [
    [-0.04, 0.02, p.matcha],
    [0.04, -0.02, p.azuki],
  ] as const) {
    const ux = UMBRELLA_STAND.x + dx;
    const uz = UMBRELLA_STAND.z + dz;
    kit.rod(root, mat, [ux, 0.3, uz], [ux, 0.66, uz], 0.025);
    kit.mesh(root, kit.torus(0.04, 0.012, Math.PI), p.woodDark, { at: [ux + 0.04, 0.68, uz] });
  }

  // 门右边：放豆袋的陈列箱，上方一条墙搁板
  const crate = DISPLAY_CRATE;
  box(root, p.wood, [crate.minX, crate.maxX], [0, crate.top - 0.03], [crate.minZ, crate.maxZ]);
  box(
    root,
    p.woodDark,
    [crate.minX + 0.03, crate.maxX - 0.03],
    [0.06, crate.top - 0.06],
    [crate.minZ - 0.005, crate.minZ],
  );
  kit.mesh(
    root,
    kit.roundedBox(crate.maxX - crate.minX + 0.03, 0.03, crate.maxZ - crate.minZ + 0.02, 0.008),
    p.honey,
    { at: [(crate.minX + crate.maxX) / 2, crate.top - 0.015, (crate.minZ + crate.maxZ) / 2] },
  );
  addBeanBag(kit, root, crate.minX + 0.12, crate.top, 2.82, "-z", p.cream);
  addBeanBag(kit, root, crate.minX + 0.31, crate.top, 2.82, "-z", p.matcha);
  addPot(kit, root, crate.maxX - 0.1, crate.top, 2.8, 0.07, 0.12, p.sage);
  onWall("front", p.woodDark, [2.6, 3.35], [1.3, 1.34], [0, 0.24]);
  addBowlStack(kit, walls.front, 2.75, 1.34, LIT_ROOM.maxZ - 0.12);
  addSmallPlant(kit, walls.front, 3.0, 1.34, LIT_ROOM.maxZ - 0.12, p.terracotta, 27);
  addTetsubin(kit, walls.front, 3.22, 1.34, LIT_ROOM.maxZ - 0.12);
  addFloorPlant(kit, root, PLANTS[2].x, PLANTS[2].z, PLANTS[2].scale, 7);

  // 窗边吧台：障子窗下一条木台面和两张高凳
  const wc = WINDOW_COUNTER;
  box(root, p.wood, [wc.minX, wc.maxX], [0, wc.top - 0.05], [wc.minZ + 0.08, wc.maxZ]);
  box(root, p.woodDark, [wc.minX, wc.maxX], [0, 0.05], [wc.minZ + 0.1, wc.maxZ]);
  kit.mesh(root, kit.roundedBox(wc.maxX - wc.minX, 0.04, wc.maxZ - wc.minZ, 0.012), p.honey, {
    at: [(wc.minX + wc.maxX) / 2, wc.top - 0.02, (wc.minZ + wc.maxZ) / 2],
  });
  for (const x of WINDOW_STOOL_X) {
    addHighStool(kit, root, x, WINDOW_STOOL_Z, 0.34);
  }
  addCandle(kit, root, -2.5, wc.top, wc.minZ + 0.18);
  addKokedama(kit, root, -3.35, wc.top, wc.minZ + 0.18);
  addMug(kit, root, -1.75, wc.top, wc.minZ + 0.16, p.porcelain, true);

  const steamAnchors = [
    new Vector3(-1.19, top + 0.12, leftZ + 0.2),
    new Vector3(STOOL_X[1], top + 0.13, BAR_MAIN.maxZ - 0.14),
    new Vector3(BENCH_TABLE.x + 0.08, BENCH_TABLE.top + 0.13, t0 + 0.08),
    new Vector3(CENTER_TABLE.x - 0.14, CENTER_TABLE.top + 0.13, CENTER_TABLE.z + 0.04),
  ];

  return {
    root,
    windowBackdropMaterial,
    sunWindows: LEFT_WINDOWS.map((z) => ({ z, y: WINDOW_Y })),
    pendantPositions,
    steamAnchors,
    /** 把挡在镜头前面的墙（斜视角下可能有两面）换成贴地收边，其余墙照常显示。 */
    cutAwayWalls(near: readonly LitWallSide[]) {
      for (const side of WALL_SIDES) {
        walls[side].visible = !near.includes(side);
        wallTrims[side].visible = near.includes(side);
      }
    },
    dispose() {
      kit.dispose();
      unitFloorPlane.dispose();
    },
  };
}
