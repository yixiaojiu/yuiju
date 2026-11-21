import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { type PixelActionName, pixelActions } from "./pixel-actions";

/** 一个屏幕像素对应的世界尺寸。角色总高约 2，渲染出来大约 44 个像素。 */
export const PIXEL = 0.04;
/**
 * 相机俯角，和光影喫茶店场景的 30° 俯视一致，角色放进场景时透视不会对不上。
 * 脸部贴图沿相机视线投影到头上，贴图格子和屏幕像素一一对应。
 */
export const ELEVATION = (30 * Math.PI) / 180;
/** 身体整体上下移动 1 个屏幕像素需要的世界高度。上下起伏按它取整，脸部像素才不会错位。 */
const PIXEL_RISE = PIXEL / Math.cos(ELEVATION);
/** 头部中心离地的高度。约 2.1 头身：头放大到 115% 时下巴约在 1.01，身体约占 22 个像素，头约占 20 个像素。 */
export const HEAD_Y = 1.32;
/**
 * 情绪符号这类贴片所在的渲染层。角色相机默认能看到这一层；
 * 渲染法线这类只需要身体网格的场合，关掉这一层就能把贴片排除在外。
 */
export const OVERLAY_LAYER = 1;
/** 头部椭球的半宽，以及上下、前后两个方向的半径。 */
const HEAD_HALF_WIDTH = 0.29,
  HEAD_RADIUS = 0.27;
/** 脸部贴图的边长（格），覆盖头部中心上下左右各 9 个像素的范围，头放大到 125% 也盖得住。 */
const FACE_GRID = 18;
/** 上半身绕着转的腰部高度，鞠躬时上半身绕这里前倾。 */
const WAIST_Y = 0.52;
/** 肩膀位置（上半身空间，x 取绝对值），手臂从这里伸向手的位置。 */
const SHOULDER: Vector3 = new Vector3(0.2, 0.88, 0);
/** 马尾绕系结往里收拢的角度，两条马尾贴着身体两侧垂下。 */
const TAIL_SPREAD = (-3 * Math.PI) / 180;
/** 两条腿在胯部的转轴高度，藏在裙子里。 */
const LEG_Y = 0.32;
/**
 * 情绪符号中心相对头部中心投影位置的屏幕偏移（像素），在帽子右上方外面。
 * 按屏幕偏移而不是挂在头上，角色转到任何朝向时符号都在画面里同一个位置。
 */
const EMOTE_OFFSET = { right: 11, up: 15 };
/** 一次性情绪符号显示的秒数。 */
const EMOTE_SECONDS = 1.8;

export type Vec3 = readonly [number, number, number];

/** 动作每帧给出的姿势。坐标在上半身空间，脚底为原点，+Z 朝前。 */
export type PixelPose = {
  /** 身体整体上下移动的像素数，负数下沉。按整像素移动，脸部像素不会错位。 */
  rise: number;
  /** 头相对身体下沉的像素数，用来表现点头。 */
  headDrop: number;
  /** 上半身绕腰前倾的角度（弧度）。 */
  lean: number;
  /** 屏幕左侧、右侧两只手的位置。 */
  hands: readonly [Vec3, Vec3];
  /** 走路的步伐相位（每 2π 走两步），站着时为 null。 */
  step: number | null;
  /** 坐着时两腿向前抬平；坐的高度由摆放角色的一方决定。 */
  seated: boolean;
  /** 动作要求的眼睛和嘴，为 null 时用当前表情的。 */
  eyes: EyeShape | null;
  mouth: MouthShape | null;
  /** 杯子的位置，为 null 时不显示杯子。 */
  cup: Vec3 | null;
  /** 动作自带的情绪符号，比如思考时的「…」。 */
  emote: EmoteName | null;
};

export const characterSliders = [
  { key: "headSize", label: "头部大小", initial: 115, min: 95, max: 125 },
  { key: "eyeSpacing", label: "眼距", initial: 0, min: -1, max: 1 },
  { key: "eyeHeight", label: "眼睛高度", initial: 0, min: -1, max: 1 },
  { key: "tailLength", label: "马尾长度", initial: 100, min: 80, max: 120 },
  { key: "hatTilt", label: "帽子倾斜", initial: 0, min: -20, max: 25 },
] as const;

export type CharacterShape = Record<(typeof characterSliders)[number]["key"], number>;
export const initialCharacterShape = Object.fromEntries(
  characterSliders.map(({ key, initial }) => [key, initial]),
) as CharacterShape;

/** 画面中心：x、z 是地面位置，up 是画面中心比该位置上的头部中心高出的像素数。 */
export type PixelFocus = { x: number; z: number; up: number };

/**
 * 角色专用的正交相机。脸部贴图按这里的像素尺寸和俯角逐格设计，所以相机由角色模块给出。
 * width、height 是渲染目标的像素数，都应为偶数。
 */
export function createPixelCamera(
  width: number,
  height: number,
  focus: PixelFocus = { x: 0, z: 0, up: -10 },
) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  aimPixelCamera(camera, width, height, focus);
  return camera;
}

/**
 * 按画面大小调整相机的取景范围，并把画面中心对到 focus。focus 会对齐像素网格，
 * 站在对齐过的位置上的角色（见 snapToPixelGrid），脸部贴图格子都和屏幕像素重合。
 */
export function aimPixelCamera(
  camera: OrthographicCamera,
  width: number,
  height: number,
  focus: PixelFocus,
) {
  camera.left = (-width * PIXEL) / 2;
  camera.right = (width * PIXEL) / 2;
  camera.top = (height * PIXEL) / 2;
  camera.bottom = (-height * PIXEL) / 2;
  camera.updateProjectionMatrix();
  const center = snapToPixelGrid(new Vector3(focus.x, HEAD_Y + focus.up * PIXEL_RISE, focus.z));
  camera.position.set(
    center.x,
    center.y + 15 * Math.sin(ELEVATION),
    center.z + 15 * Math.cos(ELEVATION),
  );
  camera.lookAt(center);
  camera.layers.enable(OVERLAY_LAYER);
  // 角色每帧按相机矩阵对齐情绪符号的位置，渲染前就需要它。
  camera.updateMatrixWorld();
}

/**
 * 把角色的摆放位置对齐到像素网格：左右移动整像素，高度和前后各自在屏幕上移动整像素。
 * 角色只在渲染时用对齐后的位置，逻辑位置可以连续变化。
 */
export function snapToPixelGrid(position: Vector3) {
  const depthStep = PIXEL / Math.sin(ELEVATION);
  return new Vector3(
    Math.round(position.x / PIXEL) * PIXEL,
    Math.round(position.y / PIXEL_RISE) * PIXEL_RISE,
    Math.round(position.z / depthStep) * depthStep,
  );
}

/**
 * 正面的脸部贴图，从上到下一行一格，沿正面视线投影到头上。头发外壳在额头上方退开，
 * 刘海整片画在贴图里：第 5 行以上藏在帽子下面，h 是发缕之间的细缝，第 9 行是长短不一的刘海尖，
 * 正好压在眼睛上沿，中间分开一道小缝露出额头；左右三列是鬓发。眼睛、腮红、嘴在 paintFace 里叠上去。
 * H 头发，h 发缝，. 皮肤。
 */
const frontRows = [
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHhHHHHhHHHHHH",
  "HHHHHhHHHHHHhHHHHH",
  "HHHHhHHHH.HHHhHHHH",
  "HHH.HHHH..HHHH.HHH",
  "HHH............HHH",
  "HHH............HHH",
  "HHH............HHH",
  "HHH............HHH",
  "HHHH..........HHHH",
  "HHHH..........HHHH",
  "HHHHH........HHHHH",
  "HHHHH........HHHHH",
];
/**
 * 侧面的脸部贴图，按脸朝屏幕右边画，最后一列朝前；脸朝左时左右翻转使用。
 * 刘海从额头往前垂到眼睛上方；鬓发后面都是头发，脸只露出最前面几列：一只眼睛、腮红和嘴角。
 */
const sideRows = [
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHhHHHHH",
  "HHHHHHHHHHHHHhHHHH",
  "HHHHHHHHHHHHHHhH..",
  "HHHHHHHHHHHHHHHH..",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHH......",
  "HHHHHHHHHHHHH.....",
  "HHHHHHHHHHHHH.....",
];
/**
 * 正面的眼睛，3×4，两只眼睛用同一个图案（不镜像），高光都在左上，像光从左上方照来。
 * 最上一行是最深的睫毛线，下面是瞳孔，左上角 1 像素白色高光；不画眼白。
 * k 睫毛线和闭眼线，d 瞳孔深色，p 瞳孔，l 瞳孔下半的亮色，w 高光，. 不改动。
 */
const eyeStamps = {
  open: ["kkk", "wdd", "ppp", "lll"],
  closed: ["...", "...", "kkk", "..."],
  happy: ["...", ".k.", "k.k", "..."],
  shy: ["...", "kkk", "wpp", "lll"],
  surprised: ["kkk", "ddd", "dwd", "ddd"],
};
export type EyeShape = keyof typeof eyeStamps;
/** 侧面看到的那只眼睛，2×4，按脸朝右画，画法和正面一致。 */
const sideEyeStamps: Record<EyeShape, string[]> = {
  open: ["kk", "wd", "pp", "ll"],
  closed: ["..", "..", "kk", ".."],
  happy: ["..", "kk", "k.", ".."],
  shy: ["..", "kk", "wp", "ll"],
  surprised: ["kk", "dd", "wd", "dd"],
};
/** 嘴的图案，以脸部贴图第 MOUTH_ROW 行、左右居中的位置为基准叠上去。q 接近肤色的浅嘴线，o 张开的嘴里。 */
const mouthStamps = {
  line: ["qq"],
  smile: ["q..q", ".qq."],
  open: ["oo"],
};
export type MouthShape = keyof typeof mouthStamps;
/** 侧面的嘴只有嘴角一格，画在第 MOUTH_ROW 行、下巴前缘的 SIDE_MOUTH_COLUMN 列。 */
const sideMouthStamps: Record<MouthShape, string[]> = {
  line: ["q"],
  smile: ["q"],
  open: ["o"],
};
const MOUTH_ROW = 15,
  SIDE_MOUTH_COLUMN = 12;

/** 表情决定眼睛、嘴和腮红宽度；动作可以临时指定眼睛和嘴，比如点头时闭眼。 */
export const expressions = {
  normal: { label: "普通", eyes: "open", mouth: "line", blush: 2 },
  happy: { label: "开心", eyes: "happy", mouth: "smile", blush: 2 },
  shy: { label: "害羞", eyes: "shy", mouth: "line", blush: 3 },
  surprised: { label: "惊讶", eyes: "surprised", mouth: "open", blush: 2 },
} satisfies Record<string, { label: string; eyes: EyeShape; mouth: MouthShape; blush: number }>;
export type ExpressionName = keyof typeof expressions;

/**
 * 头顶的情绪符号，一个符号可以有几帧轮流显示。r/R 爱心，w/g 气泡和点，y 感叹号，s/S 汗滴，n 音符。
 * 符号外圈的深色描边由后处理统一画。
 */
export const emotes = {
  heart: {
    label: "爱心",
    frames: [[".rr.rr.", "rRrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."]],
  },
  dots: {
    label: "…",
    frames: [
      [".wwwwwww.", "wwwwwwwww", "wwgwwwwww", "wwwwwwwww", ".wwwwwww.", "..ww....."],
      [".wwwwwww.", "wwwwwwwww", "wwgwgwwww", "wwwwwwwww", ".wwwwwww.", "..ww....."],
      [".wwwwwww.", "wwwwwwwww", "wwgwgwgww", "wwwwwwwww", ".wwwwwww.", "..ww....."],
    ],
  },
  exclaim: { label: "!", frames: [["yy", "yy", "yy", "yy", "..", "yy"]] },
  sweat: { label: "汗滴", frames: [["..s", ".ss", "sSs", "sss", ".s."]] },
  note: { label: "音符", frames: [[".nn.", ".n.n", ".n..", "nn..", "nn.."]] },
} satisfies Record<string, { label: string; frames: string[][] }>;
export type EmoteName = keyof typeof emotes;
/** 眼睛最上一行（睫毛线）所在的贴图行，紧贴在刘海尖下面；正面左眼在默认眼距下的起始列；侧面那只眼睛的起始列。 */
const EYE_ROW = 10,
  EYE_COLUMN = 4,
  EYE_WIDTH = 3,
  SIDE_EYE_COLUMN = 13;

const hair = "#e2b996",
  /** 马尾比头发深一档：正面看鬓发压在马尾上时分得开层次。 */
  tailHair = "#cfa27f",
  skin = "#ffe6d5",
  legSkin = "#f6cdb6",
  pearl = "#fffaf3",
  blue = "#8cc8ea",
  cream = "#ffe2a3",
  rib = "#f2c983",
  gold = "#e8b65a",
  brown = "#9c6340";
const facePalette: Record<string, string> = {
  H: hair,
  h: tailHair,
  ".": skin,
  k: "#45263f",
  d: "#563076",
  p: "#7d4ea8",
  l: "#c99be2",
  b: "#f6aaa6",
  q: "#e09a90",
  o: "#b0606a",
  r: "#ff6f96",
  R: "#ffc4d6",
  w: "#ffffff",
  g: "#6b5a66",
  y: "#ff5d4a",
  s: "#69bdf0",
  S: "#d6f1ff",
  n: "#8a63c9",
};

// Each ring specifies height, center X/Z, and its two radii, from bottom to top.
type Ring = [number, number, number, number, number];

function volume(rings: Ring[], pleats = 0) {
  const positions: number[] = [],
    indices: number[] = [];
  const segments = 40;
  for (const [row, [y, x, z, rx, rz]] of rings.entries()) {
    for (let i = 0; i <= segments; i++) {
      const angle = ((i / segments) * 2 - 1) * Math.PI;
      const fold = 1 + pleats * Math.cos(angle * 12);
      positions.push(x + Math.sin(angle) * rx * fold, y, z + Math.cos(angle) * rz * fold);
      if (row > 0 && i < segments) {
        const a = (row - 1) * (segments + 1) + i,
          b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (let i = 1; i < segments - 1; i++) {
    const top = (rings.length - 1) * (segments + 1);
    indices.push(0, i + 1, i, top, top + i, top + i + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Wrap the lighting across the duplicated seam at the back.
  const normals = geometry.getAttribute("normal");
  const startNormal = new Vector3(),
    endNormal = new Vector3();
  for (let row = 0; row < rings.length; row++) {
    const first = row * (segments + 1),
      last = first + segments;
    startNormal
      .fromBufferAttribute(normals, first)
      .add(endNormal.fromBufferAttribute(normals, last))
      .normalize();
    normals.setXYZ(first, startNormal.x, startNormal.y, startNormal.z);
    normals.setXYZ(last, startNormal.x, startNormal.y, startNormal.z);
  }
  return geometry;
}

function pivot(parent: Group, x: number, y: number, z: number) {
  const group = new Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

/** 把字符画变成像素贴图，. 是透明像素。 */
function pixelTexture(stamp: readonly string[]) {
  const width = stamp[0].length,
    height = stamp.length;
  const data = new Uint8Array(width * height * 4);
  for (const [row, line] of stamp.entries()) {
    for (const [column, cell] of [...line].entries()) {
      if (cell !== ".") {
        const rgb = parseInt(facePalette[cell].slice(1), 16);
        data.set(
          [rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255],
          ((height - 1 - row) * width + column) * 4,
        );
      }
    }
  }
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 搭建 2.5 头身的像素角色，脚底在原点，正面朝 +Z。只保证正面、背面、左右侧面四个朝向渲染正常。
 * camera 是 createPixelCamera 给出的相机，每帧用它把情绪符号对齐到像素网格。
 */
export function createPixelCharacter(camera: OrthographicCamera) {
  const root = new Group();
  // 身体（含头）整体按像素起伏；腿留在 root 上，起伏时脚不离地。
  const body = pivot(root, 0, 0, 0);
  // 上半身绕腰前倾：waist 在腰部高度转动，upper 再移回原点，上半身的部件仍按脚底为原点摆放。
  const waist = pivot(body, 0, WAIST_Y, 0);
  const upper = pivot(waist, 0, -WAIST_Y, 0);
  const head = pivot(upper, 0, HEAD_Y, 0);

  function faceTexture() {
    const data = new Uint8Array(FACE_GRID * FACE_GRID * 4);
    const texture = new DataTexture(data, FACE_GRID, FACE_GRID);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = texture.minFilter = NearestFilter;
    return { data, texture };
  }
  const frontFace = faceTexture(),
    sideFace = faceTexture();

  /** 把字符画里不是 . 的格子盖到 grid 上，左上角在第 top 行、第 left 列。 */
  function stamp(grid: string[][], pattern: readonly string[], top: number, left: number) {
    for (const [row, line] of pattern.entries()) {
      for (const [column, cell] of [...line].entries()) {
        if (cell !== ".") {
          grid[top + row][left + column] = cell;
        }
      }
    }
  }
  /** 把整张字符画写进脸部贴图。DataTexture 的第一行在贴图底部，所以倒着写入。 */
  function upload(grid: string[][], face: ReturnType<typeof faceTexture>) {
    for (const [row, cells] of grid.entries()) {
      for (const [column, cell] of cells.entries()) {
        const rgb = parseInt(facePalette[cell].slice(1), 16);
        const offset = ((FACE_GRID - 1 - row) * FACE_GRID + column) * 4;
        face.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], offset);
      }
    }
    face.texture.needsUpdate = true;
  }
  /** 按造型参数和当前的眼睛、嘴、腮红，重画正面和侧面两张脸。 */
  function paintFace(next: CharacterShape, eyes: EyeShape, mouth: MouthShape, blush: number) {
    const top = EYE_ROW - next.eyeHeight;
    const left = EYE_COLUMN - next.eyeSpacing,
      right = FACE_GRID - EYE_COLUMN - EYE_WIDTH + next.eyeSpacing;

    const front = frontRows.map((row) => [...row]);
    // 腮红在眼睛下方，从外眼角外侧一格往里画 blush 格。
    for (let k = 0; k < blush; k++) {
      front[top + 4][left - 1 + k] = front[top + 4][right + EYE_WIDTH - k] = "b";
    }
    stamp(front, eyeStamps[eyes], top, left);
    stamp(front, eyeStamps[eyes], top, right);
    const mouthStamp = mouthStamps[mouth];
    stamp(front, mouthStamp, MOUTH_ROW, FACE_GRID / 2 - mouthStamp[0].length / 2);
    upload(front, frontFace);

    const side = sideRows.map((row) => [...row]);
    // 侧面的腮红在眼睛下方，从眼睛前缘往后画 blush 格。
    for (let k = 0; k < blush; k++) {
      side[top + 4][SIDE_EYE_COLUMN + 1 - k] = "b";
    }
    stamp(side, sideEyeStamps[eyes], top, SIDE_EYE_COLUMN);
    stamp(side, sideMouthStamps[mouth], MOUTH_ROW, SIDE_MOUTH_COLUMN);
    upload(side, sideFace);
  }

  const materials = new Map<string, ShaderMaterial>();
  /** 自带的两档明暗：1 打开，0 只输出底色（放进有真实灯光的场景时，由场景光照决定明暗）。所有材质共用。 */
  const celShading = { value: 1 };
  /**
   * 两档明暗的卡通材质。光照方向固定在相机空间，角色转身时亮面始终在画面左上。
   * variant 为 face 时颜色取自脸部贴图；为 soft 时只在背光很重的边缘画暗色，头发、袖子基本是一整块纯色。
   */
  function cel(color: string, variant?: "face" | "soft") {
    const key = variant ? variant + color : color;
    const existing = materials.get(key);
    if (existing) {
      return existing;
    }
    const material = new ShaderMaterial({
      uniforms: {
        pigment: { value: new Color(color) },
        frontMap: { value: frontFace.texture },
        sideMap: { value: sideFace.texture },
        faceSpan: { value: FACE_GRID * PIXEL },
        celShading,
      },
      defines: variant === "face" ? { FACE_MAP: 1 } : variant === "soft" ? { SOFT_SHADOW: 1 } : {},
      vertexShader: `
        varying vec3 vNormal; varying vec3 vFace;
        void main(){
          vNormal=normalMatrix*normal;
          #ifdef FACE_MAP
          // 脸部贴图按屏幕像素查：xy 是这个点离头部中心的屏幕偏移，贴图一格正好是一个屏幕像素。
          // 镜头从侧面看时改用侧面贴图（z 为 1），脸朝左时左右翻转，让侧面贴图的最后一列始终在脸的前面。
          vec3 offset=mat3(modelViewMatrix)*position;
          vec3 toCamera=vec3(modelViewMatrix[0][2],modelViewMatrix[1][2],modelViewMatrix[2][2]);
          float side=step(abs(toCamera.z),abs(toCamera.x));
          vFace=vec3(offset.x*mix(1.,sign(modelViewMatrix[2][0]),side),offset.y,side);
          #endif
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }`,
      fragmentShader: `
        uniform vec3 pigment; uniform sampler2D frontMap; uniform sampler2D sideMap; uniform float faceSpan;
        uniform float celShading;
        varying vec3 vNormal; varying vec3 vFace;
        void main(){
          float d=dot(normalize(vNormal),normalize(vec3(-.45,.75,.5)));
          vec3 shadow=vec3(.84,.74,.8);
          #ifdef FACE_MAP
          vec2 grid=vFace.xy/faceSpan+.5;
          vec3 base=vFace.z>.5 ? texture2D(sideMap,grid).rgb : texture2D(frontMap,grid).rgb;
          gl_FragColor=vec4(d < -.4 ? mix(base,base*shadow,celShading) : base,1.);
          #else
          float edge=.08;
          #ifdef SOFT_SHADOW
          edge=-.35;
          #endif
          gl_FragColor=vec4(d < edge ? mix(pigment,pigment*shadow,celShading) : pigment,1.);
          #endif
          #include <colorspace_fragment>
        }`,
    });
    materials.set(key, material);
    return material;
  }
  const sphere = new SphereGeometry(1, 24, 16);
  function oval(
    parent: Group,
    color: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    variant?: "soft",
  ) {
    const mesh = new Mesh(sphere, cel(color, variant));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }
  function sculpt(parent: Group, color: string, rings: Ring[], pleats = 0, variant?: "soft") {
    const mesh = new Mesh(volume(rings, pleats), cel(color, variant));
    parent.add(mesh);
    return mesh;
  }
  /** 方块部件：水手领的领片、开衫前襟、领结、发夹、鞋子。 */
  function block(
    parent: Group,
    color: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) {
    const mesh = new Mesh(new BoxGeometry(w, h, d), cel(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // 头和脸：脸部贴图按屏幕像素投影在头部椭球上，头发外壳向后偏，正面只露出刘海以下。
  head.add(
    new Mesh(
      new SphereGeometry(1, 32, 24).scale(HEAD_HALF_WIDTH, HEAD_RADIUS, HEAD_RADIUS),
      cel(skin, "face"),
    ),
  );
  // 头发外壳在额头上方往后退开，额头到眼睛上方的刘海由脸部贴图画。
  oval(head, hair, 0, 0.05, -0.13, 0.33, 0.31, 0.32, "soft");
  // 后脑的短发只到后颈，背面能露出水手领和开衫；两侧在脸颊旁鼓出一点，头的轮廓是圆的。
  oval(head, hair, 0, -0.15, -0.1, 0.3, 0.17, 0.23, "soft");
  // 鬓发上宽下尖，从耳前垂到下巴并往里弯，侧面看挡在眼睛后面，脸只露出前面几列。
  for (const side of [-1, 1]) {
    sculpt(
      head,
      hair,
      [
        [-0.3, side * 0.24, 0.07, 0.008, 0.008],
        [-0.24, side * 0.25, 0.06, 0.025, 0.03],
        [-0.12, side * 0.265, 0.05, 0.04, 0.045],
        [0.02, side * 0.27, 0.04, 0.045, 0.05],
        [0.14, side * 0.26, 0.03, 0.04, 0.045],
        [0.2, side * 0.24, 0, 0.02, 0.02],
      ],
      0,
      "soft",
    );
  }
  // 蓝色方形发夹别在屏幕右侧（角色的左边）、右眼外角上方的刘海上：2×2 像素的浅蓝方块，
  // 外侧伸出 2 像素的白色夹子。整体按俯角转向镜头，正面看正好是方的，侧面看只剩一条细线。
  const clip = pivot(head, 0.165, 0.16, 0.18);
  clip.rotation.x = -ELEVATION;
  block(clip, "#c4e8fb", 0, 0, 0, 0.07, 0.07, 0.02);
  block(clip, pearl, 0.07, 0.017, 0, 0.07, 0.035, 0.015);

  // 贝雷帽：蓬起来的圆顶，和头差不多宽，戴在头顶偏后，不压住额头和两侧，头的轮廓保持圆的。
  const hat = pivot(head, 0, 0.27, -0.06);
  hat.rotation.x = -0.2;
  sculpt(hat, pearl, [
    [-0.02, 0, 0, 0.27, 0.26],
    [0.03, 0, 0, 0.33, 0.32],
    [0.08, 0, 0, 0.34, 0.33],
    [0.14, 0, 0, 0.3, 0.29],
    [0.19, 0, 0, 0.2, 0.19],
    [0.22, 0, 0, 0.06, 0.06],
  ]);
  oval(hat, pearl, 0, 0.22, 0, 0.025, 0.025, 0.025);

  const tails = [-1, 1].map((side) => {
    // 马尾系在头顶两侧偏后、帽檐下面，先往外张开再垂下，到腰下面；颜色比头发深一档。
    // 侧面看马尾在背后，不挡身体。
    const tie = pivot(head, side * 0.27, 0.2, -0.13);
    const tail = pivot(tie, 0, 0, 0);
    sculpt(
      tail,
      tailHair,
      [
        [-0.95, side * 0.15, -0.18, 0.015, 0.015],
        [-0.86, side * 0.17, -0.18, 0.045, 0.04],
        [-0.6, side * 0.19, -0.17, 0.065, 0.055],
        [-0.32, side * 0.17, -0.13, 0.07, 0.06],
        [-0.08, side * 0.08, -0.05, 0.07, 0.06],
        [0.04, side * 0.02, 0, 0.05, 0.045],
        [0.08, 0, 0, 0.02, 0.02],
      ],
      0,
      "soft",
    );
    // 马尾根部的蓝丝带：系结两边的小圈，正下方垂着一条 1 像素宽的丝带，挂在马尾上跟着一起摆。
    for (const lobe of [-1, 1]) {
      oval(tie, blue, side * 0.05, lobe * 0.05, 0.03, 0.035, 0.05, 0.05);
    }
    sculpt(tail, blue, [
      [-0.22, side * 0.05, 0.06, 0.016, 0.012],
      [-0.03, side * 0.05, 0.05, 0.016, 0.012],
    ]);
    return { side, tail };
  });

  // 身体：黄色开衫、白色水手领、蓝色裙子。
  // 裙子只有五六行高，褶子画不出来，做成干净的 A 字裙，靠裙摆上方的白边认出是制服裙。
  const skirt = pivot(body, 0, 0, 0);
  // 裙子长到鞋面上方：30° 俯视时裙摆前缘正好挡住整条腿，站着只露出两只鞋，走路时鞋在裙摆下前后交替。
  sculpt(skirt, "#9fd1ee", [
    [0.18, 0, 0, 0.27, 0.21],
    [0.34, 0, 0, 0.23, 0.185],
    [0.49, 0, 0, 0.19, 0.16],
    [0.57, 0, 0, 0.17, 0.145],
  ]);
  // 白边离裙摆一个像素，下面只留一行蓝色。
  sculpt(skirt, pearl, [
    [0.22, 0, 0, 0.265, 0.209],
    [0.265, 0, 0, 0.254, 0.201],
  ]);
  sculpt(upper, cream, [
    [0.49, 0, 0, 0.21, 0.175],
    [0.55, 0, 0, 0.205, 0.17],
    [0.68, 0, 0, 0.19, 0.155],
    [0.85, 0, 0, 0.19, 0.145],
    [0.94, 0, 0, 0.15, 0.12],
    [1.0, 0, 0, 0.06, 0.05],
  ]);
  // 开衫下摆的罗纹。
  sculpt(upper, rib, [
    [0.485, 0, 0, 0.218, 0.183],
    [0.525, 0, 0, 0.214, 0.179],
  ]);
  // 上衣正面只有大块黄色、领口一道白、胸口一个 2 像素的蓝领结；V 领、开襟、纽扣、口袋都舍掉。
  // 水手领：披在肩上的一圈白领，正面看是下巴下面的一道白边；背后垂下方形领片，
  // 金色方块比领片低出一个像素，露出来就是领片下沿的金边。领子用柔和明暗，正面不会出现一排灰点。
  oval(upper, pearl, 0, 0.93, -0.005, 0.185, 0.04, 0.155, "soft");
  block(upper, blue, 0, 0.86, 0.17, 0.08, 0.05, 0.03);
  block(upper, gold, 0, 0.84, -0.153, 0.3, 0.21, 0.012);
  block(upper, pearl, 0, 0.865, -0.157, 0.3, 0.16, 0.02);

  // 手臂是一节袖子、袖口罗纹加一只手：每帧把 arm 转向手的位置，袖子按肩到手的距离拉伸，手放在末端。
  const arms = [-1, 1].map((side) => {
    const arm = pivot(upper, side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    const sleeve = oval(arm, cream, 0, 0, 0, 0.07, 1, 0.07, "soft");
    const cuff = oval(arm, rib, 0, 0, 0, 0.075, 0.035, 0.075);
    const hand = oval(arm, skin, 0, 0, 0, 0.045, 0.045, 0.045);
    return { side, arm, sleeve, cuff, hand };
  });

  // 杯子：白色杯身加咖啡色的液面，由动作决定放在哪。
  const cup = pivot(upper, 0, 0, 0);
  // 和咖啡馆台面上的杯子一样大：杯身高 0.16、半径 0.1，原点在杯底往上 0.05。
  sculpt(cup, pearl, [
    [-0.05, 0, 0, 0.085, 0.085],
    [0.11, 0, 0, 0.1, 0.1],
  ]);
  oval(cup, "#7a4a32", 0, 0.11, 0, 0.085, 0.008, 0.085);

  // 腿从裙子里的胯部开始，平时整条藏在长裙下面，只露出矮矮的长方形棕色乐福鞋；
  // 走路、坐下抬腿时才露出来，比脸深一档的肤色像是在裙子的阴影里。
  const legs = [-1, 1].map((side) => {
    const leg = pivot(root, side * 0.08, LEG_Y, 0);
    oval(leg, legSkin, 0, -0.15, 0, 0.05, 0.15, 0.05);
    block(leg, brown, 0, -0.2975, 0.03, 0.11, 0.045, 0.12);
    return { side, leg };
  });

  // 情绪符号是对齐像素的贴片，画在最上层，不被帽子挡住。
  const emoteTextures = Object.fromEntries(
    Object.entries(emotes).map(([name, { frames }]) => [
      name,
      frames.map((frame) => pixelTexture(frame)),
    ]),
  ) as Record<EmoteName, DataTexture[]>;
  const emoteSprite = new Sprite(
    new SpriteMaterial({ alphaTest: 0.5, depthTest: false, depthWrite: false }),
  );
  emoteSprite.renderOrder = 1;
  emoteSprite.layers.set(OVERLAY_LAYER);
  root.add(emoteSprite);

  /**
   * 把情绪符号放到头部中心投影后的位置，再在屏幕上右移 right、上移 up 个像素，中心对齐像素网格。
   * width、height 是贴片的像素数。
   */
  function placeEmote(width: number, height: number, right: number, up: number) {
    const view = head.localToWorld(new Vector3()).applyMatrix4(camera.matrixWorldInverse);
    view.x = camera.left + Math.round((view.x - (width * PIXEL) / 2 - camera.left) / PIXEL) * PIXEL;
    view.x += (width * PIXEL) / 2 + right * PIXEL;
    view.y =
      camera.bottom + Math.round((view.y - (height * PIXEL) / 2 - camera.bottom) / PIXEL) * PIXEL;
    view.y += (height * PIXEL) / 2 + up * PIXEL;
    emoteSprite.position.copy(root.worldToLocal(view.applyMatrix4(camera.matrixWorld)));
    emoteSprite.scale.set(width * PIXEL, height * PIXEL, 1);
  }

  let shape = initialCharacterShape;
  let expression: ExpressionName = "normal";
  /** 当前循环的动作，以及正在播放的一次性动作；一次性动作播完回到循环动作。 */
  let looping: PixelActionName = "idle";
  let loopStart = 0;
  let oneShot: { name: PixelActionName; start: number } | null = null;
  let emote: { name: EmoteName; start: number } | null = null;
  /** 最近一帧的时间，play 和 showEmote 用它作为开始时间。 */
  let now = 0;
  /** 脸部贴图上次画的眼睛、嘴和腮红，变了才重画。 */
  let painted = "";

  function applyShape(next: CharacterShape) {
    shape = next;
    head.scale.setScalar(next.headSize / 100);
    hat.rotation.z = (-next.hatTilt * Math.PI) / 180;
    for (const { tail } of tails) {
      tail.scale.y = next.tailLength / 100;
    }
    painted = "";
  }
  applyShape(shape);

  function applyPose(pose: PixelPose, time: number) {
    body.position.y = pose.rise * PIXEL_RISE;
    waist.rotation.x = pose.lean;
    head.position.y = HEAD_Y - pose.headDrop * PIXEL_RISE;

    const walk = pose.step === null ? 0 : 1;
    const beat = Math.sin(pose.step ?? 0);
    skirt.rotation.y = 0.08 * beat * walk;
    for (const { side, leg } of legs) {
      leg.rotation.x = pose.seated ? -1.45 : side * 0.55 * beat * walk;
      leg.position.y = LEG_Y + 0.04 * Math.max(0, side * Math.cos(pose.step ?? 0)) * walk;
    }
    for (const { side, tail } of tails) {
      // 走路时马尾只往后仰一点、轻轻晃，不往后甩。
      tail.rotation.x =
        0.05 * Math.sin(time * 1.6 - side) * (1 - walk) +
        (0.06 + 0.04 * Math.sin(2 * (pose.step ?? 0) - 1.2)) * walk;
      tail.rotation.z = side * (TAIL_SPREAD + 0.06 * Math.sin((pose.step ?? 0) - 0.8) * walk);
    }

    for (const [index, { side, arm, sleeve, cuff, hand }] of arms.entries()) {
      const reach = new Vector3(...pose.hands[index]).sub(arm.position);
      const length = reach.length();
      arm.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), reach.normalize());
      sleeve.position.y = -length * 0.42;
      sleeve.scale.y = length * 0.45;
      cuff.position.y = -length * 0.84;
      hand.position.y = -length;
      // 走路时手臂随步伐前后摆。
      arm.rotateX(-side * 0.3 * beat * walk);
    }

    cup.visible = pose.cup !== null;
    if (pose.cup) {
      cup.position.set(...pose.cup);
    }

    const look = expressions[expression];
    const mouth = pose.mouth ?? look.mouth;
    // 睁眼时每 3.85 秒眨一次。
    const wanted = pose.eyes ?? look.eyes;
    const eyes = wanted === "open" && time % 3.85 > 3.68 ? "closed" : wanted;
    if (painted !== eyes + mouth + look.blush) {
      painted = eyes + mouth + look.blush;
      paintFace(shape, eyes, mouth, look.blush);
    }
  }

  return {
    root,
    applyShape,
    /** 播放动作：循环动作替换当前的循环；一次性动作立即播放，播完回到当前的循环。 */
    play(name: PixelActionName) {
      if (pixelActions[name].loop) {
        looping = name;
        loopStart = now;
        oneShot = null;
      } else {
        oneShot = { name, start: now };
      }
    },
    /** 打开或关闭自带的两档明暗。 */
    setCelShading(enabled: boolean) {
      celShading.value = enabled ? 1 : 0;
    },
    setExpression(name: ExpressionName) {
      expression = name;
    },
    /** 在头顶冒一个情绪符号，EMOTE_SECONDS 秒后消失。 */
    showEmote(name: EmoteName) {
      emote = { name, start: now };
    },
    animate(time: number) {
      now = time;
      if (oneShot && time - oneShot.start > pixelActions[oneShot.name].duration) {
        oneShot = null;
      }
      const pose = oneShot
        ? pixelActions[oneShot.name].pose(time - oneShot.start)
        : pixelActions[looping].pose(time - loopStart);
      applyPose(pose, time);

      // 一次性的情绪符号优先，冒出来后 0.5 秒内往上飘 3 像素；动作自带的符号原地显示。
      if (emote && time - emote.start > EMOTE_SECONDS) {
        emote = null;
      }
      const shown = emote
        ? { name: emote.name, age: time - emote.start }
        : pose.emote && { name: pose.emote, age: 0 };
      emoteSprite.visible = Boolean(shown);
      if (shown) {
        root.updateMatrixWorld(true);
        const frames = emoteTextures[shown.name];
        const texture = frames[Math.floor(time / 0.4) % frames.length];
        emoteSprite.material.map = texture;
        const { width, height } = texture.image;
        const rise = Math.floor(Math.min(shown.age, 0.5) * 6);
        placeEmote(width, height, EMOTE_OFFSET.right, EMOTE_OFFSET.up + rise);
      }
    },
    dispose() {
      const geometries = new Set<BufferGeometry>();
      root.traverse((node) => {
        if (node instanceof Mesh) {
          geometries.add(node.geometry);
        }
      });
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials.values()) {
        material.dispose();
      }
      frontFace.texture.dispose();
      sideFace.texture.dispose();
      emoteSprite.material.dispose();
      for (const frames of Object.values(emoteTextures)) {
        for (const texture of frames) {
          texture.dispose();
        }
      }
    },
  };
}
