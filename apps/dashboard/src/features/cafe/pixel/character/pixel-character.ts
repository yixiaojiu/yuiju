import {
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
  Vector2,
  Vector3,
} from "three";
import { type PixelActionName, pixelActions } from "./pixel-actions";

/** 一个屏幕像素对应的世界尺寸。角色总高约 1.6，渲染出来大约 36 个像素。 */
export const PIXEL = 0.04;
/** 相机俯角。脸部贴图沿这个方向投影到头上，正面看时贴图格子和屏幕像素一一对应。 */
export const ELEVATION = (35 * Math.PI) / 180;
/** 身体整体上下移动 1 个屏幕像素需要的世界高度。上下起伏按它取整，脸部像素才不会错位。 */
const PIXEL_RISE = PIXEL / Math.cos(ELEVATION);
/** 头部中心离地的高度。 */
export const HEAD_Y = 1.12;
/** 头部椭球的半宽，以及上下、前后两个方向的半径。 */
const HEAD_HALF_WIDTH = 0.44,
  HEAD_RADIUS = 0.4;
/** 眼睛朝向和指向相机方向的夹角余弦低于它时隐藏眼睛，转到背面就看不到眼睛。 */
const EYE_FACING = 0.3;
/** 眼睛锚点所在内层椭球相对头部的比例。正面投影位置不变，转到侧面时眼睛离轮廓更远，不会凸出脸外。 */
const EYE_DEPTH = 0.8;
/** 眼睛贴片朝相机前移的距离，避免被头部自身的表面挡住；背面由 EYE_FACING 负责隐藏。 */
const EYE_LIFT = 0.25;
/** 脸部贴图的边长（格），覆盖头部局部坐标 [-0.44, 0.44] 的范围。 */
const FACE_GRID = 22;
/** 上半身绕着转的腰部高度，鞠躬时上半身绕这里前倾。 */
const WAIST_Y = 0.42;
/** 肩膀位置（上半身空间，x 取绝对值），手臂从这里伸向手的位置。 */
const SHOULDER: Vector3 = new Vector3(0.18, 0.6, 0);
/**
 * 情绪符号中心相对头部中心投影位置的屏幕偏移（像素），在帽子右上方外面。
 * 按屏幕偏移而不是挂在头上，角色转到任何朝向时符号都在画面里同一个位置。
 */
const EMOTE_OFFSET = { right: 13, up: 16 };
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
  { key: "headSize", label: "头部大小", initial: 100, min: 90, max: 112 },
  { key: "eyeSpacing", label: "眼距", initial: 0, min: -1, max: 1 },
  { key: "eyeHeight", label: "眼睛高度", initial: 0, min: -1, max: 1 },
  { key: "tailLength", label: "马尾长度", initial: 100, min: 80, max: 120 },
  { key: "tailSpread", label: "马尾张开", initial: 0, min: -6, max: 20 },
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
  focus: PixelFocus = { x: 0, z: 0, up: -7 },
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
  // 角色每帧按相机矩阵对齐眼睛位置，渲染前就需要它。
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
 * 脸部贴图，从上到下一行一格。上面几行会被头发外壳挡住，露出来的是刘海尖、眼睛和下半张脸；
 * 左右四列是鬓发，和眼睛之间隔一列皮肤。刘海下沿直接压在眼睛上沿，两眼之间的额头高出一行，
 * 左侧一道斜分缝露出阶梯状的皮肤，让刘海有走向。腮红随眼睛位置在 paintFace 里叠上去；
 * 眼睛不在贴图里，而是始终朝向相机的贴片，见 createPixelCharacter。
 * 嘴和腮红随表情在 paintFace 里叠上去。H 头发，. 皮肤。
 */
const faceRows = [
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHHHHHHHH",
  "HHHHHHHHH.HHHHHHHHHHHH",
  "HHHHHHHHHH.HHHHHHHHHHH",
  "HHHHHHHHHH..HHHHHHHHHH",
  "HHHH.HHHH....HHHH.HHHH",
  "HHHH.........H....HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
  "HHHH..............HHHH",
];
/**
 * 屏幕左侧那只眼睛，第一列是外眼角，右眼左右镜像。眼睛不画白色高光和睫毛线，只用从深到浅的三档紫色，
 * 小五官配大块头发，在低分辨率下更显精致。k 闭眼线，d 瞳孔深色，p 瞳孔，l 瞳孔下半的亮色，. 透明。
 */
const eyeStamps = {
  open: ["ddd", "ddd", "ppp", "lll"],
  closed: ["...", "...", "kkk", "..."],
  happy: ["...", ".d.", "d.d", "..."],
  shy: ["...", "kkk", "ppp", "lll"],
  surprised: ["ddd", "d.d", "d.d", "ddd"],
};
export type EyeShape = keyof typeof eyeStamps;
/** 嘴的图案，以脸部贴图第 MOUTH_ROW 行、左右居中的位置为基准叠上去。m 嘴线，o 张开的嘴里。 */
const mouthStamps = {
  line: ["mm"],
  smile: ["m..m", ".mm."],
  open: ["oo", "oo"],
};
export type MouthShape = keyof typeof mouthStamps;
const MOUTH_ROW = 18;

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
/** 正面视角下眼睛最上一行所在的贴图行，以及左眼在默认眼距下的起始列。 */
const EYE_ROW = 13,
  EYE_COLUMN = 5,
  EYE_WIDTH = 3;

const hair = "#e2b996",
  skin = "#ffe6d5",
  pearl = "#fffaf3",
  blue = "#8cc8ea",
  cream = "#ffe2a3",
  rib = "#f2c983",
  brown = "#9c6340";
const facePalette: Record<string, string> = {
  H: hair,
  ".": skin,
  k: "#45263f",
  d: "#563076",
  p: "#7d4ea8",
  l: "#c99be2",
  b: "#f6aaa6",
  m: "#bd6762",
  o: "#93404a",
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

/**
 * 头部椭球（各轴按 scale 缩放）朝前的那一侧上，横坐标为 x、正面视角下屏幕高度为 up 的点。
 * up 是头部局部坐标在屏幕上方向 (0, cos, -sin) 上的分量。
 */
function facePoint(x: number, up: number, scale: number) {
  const radius = HEAD_RADIUS * scale * Math.sqrt(1 - (x / (HEAD_HALF_WIDTH * scale)) ** 2);
  const angle = ELEVATION + Math.asin(up / radius);
  return new Vector3(x, radius * Math.sin(angle), radius * Math.cos(angle));
}

/** 把字符画变成像素贴图，. 是透明像素。mirrored 时左右翻转，用于右眼。 */
function pixelTexture(stamp: readonly string[], mirrored: boolean) {
  const width = stamp[0].length,
    height = stamp.length;
  const data = new Uint8Array(width * height * 4);
  for (const [row, line] of stamp.entries()) {
    for (const [column, cell] of [...line].entries()) {
      if (cell !== ".") {
        const rgb = parseInt(facePalette[cell].slice(1), 16);
        const x = mirrored ? width - 1 - column : column;
        data.set(
          [rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255],
          ((height - 1 - row) * width + x) * 4,
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
 * 搭建大头像素角色，脚底在原点，正面朝 +Z。
 * camera 是 createPixelCamera 给出的相机，每帧用它把眼睛贴片对齐到像素网格。
 */
export function createPixelCharacter(camera: OrthographicCamera) {
  const root = new Group();
  // 身体（含头）整体按像素起伏；腿留在 root 上，起伏时脚不离地。
  const body = pivot(root, 0, 0, 0);
  // 上半身绕腰前倾：waist 在腰部高度转动，upper 再移回原点，上半身的部件仍按脚底为原点摆放。
  const waist = pivot(body, 0, WAIST_Y, 0);
  const upper = pivot(waist, 0, -WAIST_Y, 0);
  const head = pivot(upper, 0, HEAD_Y, 0);

  const faceData = new Uint8Array(FACE_GRID * FACE_GRID * 4);
  const faceMap = new DataTexture(faceData, FACE_GRID, FACE_GRID);
  faceMap.colorSpace = SRGBColorSpace;
  faceMap.magFilter = faceMap.minFilter = NearestFilter;

  function paintFace(next: CharacterShape, mouth: MouthShape, blush: number) {
    const grid = faceRows.map((row) => [...row]);
    const top = EYE_ROW - next.eyeHeight;
    const left = EYE_COLUMN - next.eyeSpacing,
      right = FACE_GRID - EYE_COLUMN - EYE_WIDTH + next.eyeSpacing;
    // 腮红在眼睛下方，从外眼角外侧一格往里画 blush 格。
    for (let k = 0; k < blush; k++) {
      grid[top + 4][left - 1 + k] = grid[top + 4][right + EYE_WIDTH - k] = "b";
    }
    const stamp = mouthStamps[mouth];
    const mouthLeft = FACE_GRID / 2 - stamp[0].length / 2;
    for (const [row, line] of stamp.entries()) {
      for (const [column, cell] of [...line].entries()) {
        if (cell !== ".") {
          grid[MOUTH_ROW + row][mouthLeft + column] = cell;
        }
      }
    }
    // DataTexture 的第一行在贴图底部，所以倒着写入。
    for (const [row, cells] of grid.entries()) {
      for (const [column, cell] of cells.entries()) {
        const rgb = parseInt(facePalette[cell].slice(1), 16);
        const offset = ((FACE_GRID - 1 - row) * FACE_GRID + column) * 4;
        faceData.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], offset);
      }
    }
    faceMap.needsUpdate = true;
  }

  const materials = new Map<string, ShaderMaterial>();
  /**
   * 两档明暗的卡通材质。光照方向固定在相机空间，角色转身时亮面始终在画面左上。
   * variant 为 face 时颜色取自脸部贴图；为 hair 时只在背光很重的边缘画暗色，头发基本是一整块纯色。
   */
  function cel(color: string, variant?: "face" | "hair") {
    const key = variant ? variant + color : color;
    const existing = materials.get(key);
    if (existing) {
      return existing;
    }
    const material = new ShaderMaterial({
      uniforms: {
        pigment: { value: new Color(color) },
        faceMap: { value: faceMap },
        // 贴图沿相机方向投影：屏幕上方向在头部局部坐标里是 (0, cos, -sin)。
        projection: { value: new Vector2(Math.cos(ELEVATION), Math.sin(ELEVATION)) },
        faceSpan: { value: FACE_GRID * PIXEL },
      },
      defines: variant === "face" ? { FACE_MAP: 1 } : variant === "hair" ? { SOFT_SHADOW: 1 } : {},
      vertexShader: `
        varying vec3 vNormal; varying vec3 vLocal;
        void main(){ vNormal=normalMatrix*normal; vLocal=position;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }`,
      fragmentShader: `
        uniform vec3 pigment; uniform sampler2D faceMap; uniform vec2 projection; uniform float faceSpan;
        varying vec3 vNormal; varying vec3 vLocal;
        void main(){
          float d=dot(normalize(vNormal),normalize(vec3(-.45,.75,.5)));
          vec3 shadow=vec3(.7,.55,.66);
          #ifdef FACE_MAP
          vec2 projected=vec2(vLocal.x,vLocal.y*projection.x-vLocal.z*projection.y);
          vec3 base=texture2D(faceMap,projected/faceSpan+.5).rgb;
          gl_FragColor=vec4(d < -.4 ? base*shadow : base,1.);
          #else
          float edge=.08;
          #ifdef SOFT_SHADOW
          edge=-.35;
          #endif
          gl_FragColor=vec4(d < edge ? pigment*shadow : pigment,1.);
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
    variant?: "hair",
  ) {
    const mesh = new Mesh(sphere, cel(color, variant));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }
  function sculpt(parent: Group, color: string, rings: Ring[], pleats = 0, variant?: "hair") {
    const mesh = new Mesh(volume(rings, pleats), cel(color, variant));
    parent.add(mesh);
    return mesh;
  }

  // 头和脸：脸部贴图投影在头部椭球上，头发外壳向后偏，正面只露出额头以下。
  head.add(
    new Mesh(
      new SphereGeometry(1, 32, 24).scale(HEAD_HALF_WIDTH, HEAD_RADIUS, HEAD_RADIUS),
      cel(skin, "face"),
    ),
  );
  oval(head, hair, 0, 0.05, -0.12, 0.47, 0.46, 0.44, "hair");
  oval(head, hair, 0, -0.28, -0.22, 0.3, 0.28, 0.22, "hair");
  // 鬓发细而短，笔直垂到下巴，不和马尾抢轮廓。
  for (const side of [-1, 1]) {
    sculpt(
      head,
      hair,
      [
        [-0.3, side * 0.36, 0.2, 0.03, 0.025],
        [-0.26, side * 0.36, 0.21, 0.04, 0.035],
        [-0.1, side * 0.36, 0.25, 0.04, 0.035],
        [0.02, side * 0.36, 0.26, 0.04, 0.035],
        [0.12, side * 0.36, 0.24, 0.02, 0.02],
      ],
      0,
      "hair",
    );
  }

  // 贝雷帽：贴头的一圈较窄，往上鼓出比头还宽的帽檐，再收到顶上的小帽尖。
  const hat = pivot(head, 0, 0.4, -0.1);
  hat.rotation.x = -0.15;
  sculpt(hat, pearl, [
    [-0.03, 0, 0, 0.33, 0.31],
    [0.0, 0, 0, 0.37, 0.35],
    [0.045, 0, 0, 0.47, 0.43],
    [0.1, 0, 0, 0.43, 0.39],
    [0.145, 0, 0, 0.29, 0.27],
    [0.165, 0, 0, 0.08, 0.08],
  ]);
  oval(hat, pearl, 0, 0.165, 0, 0.03, 0.03, 0.03);
  for (const lobe of [-1, 1]) {
    oval(hat, "#efe6ee", 0.42, 0.05 + lobe * 0.045, 0.17, 0.035, 0.05, 0.035);
  }

  const tails = [-1, 1].map((side) => {
    // 马尾挂在头侧偏后，贴着身体垂下，让整体剪影收成一团。
    const tie = pivot(head, side * 0.4, 0.1, -0.22);
    const tail = pivot(tie, 0, 0, 0);
    sculpt(
      tail,
      hair,
      [
        [-1.02, side * 0.03, 0, 0.02, 0.02],
        [-0.9, side * 0.06, -0.02, 0.07, 0.06],
        [-0.65, side * 0.09, -0.04, 0.12, 0.1],
        [-0.36, side * 0.1, -0.04, 0.14, 0.12],
        [-0.1, side * 0.08, -0.02, 0.13, 0.11],
        [0.03, side * 0.04, 0, 0.09, 0.08],
        [0.07, side * 0.01, 0, 0.03, 0.03],
      ],
      0,
      "hair",
    );
    for (const lobe of [-1, 1]) {
      oval(tie, blue, side * 0.07, lobe * 0.06, 0.05, 0.045, 0.06, 0.07);
    }
    return { side, tail };
  });

  // 身体：开衫、水手领、百褶裙。
  const skirt = pivot(body, 0, 0, 0);
  sculpt(
    skirt,
    "#9fd1ee",
    [
      [0.22, 0, 0, 0.3, 0.27],
      [0.3, 0, 0, 0.27, 0.24],
      [0.38, 0, 0, 0.23, 0.2],
      [0.44, 0, 0, 0.19, 0.17],
    ],
    0.06,
  );
  sculpt(
    skirt,
    pearl,
    [
      [0.25, 0, 0, 0.297, 0.267],
      [0.28, 0, 0, 0.283, 0.253],
    ],
    0.06,
  );
  sculpt(upper, cream, [
    [0.36, 0, 0.01, 0.21, 0.19],
    [0.4, 0, 0.01, 0.215, 0.19],
    [0.55, 0, 0, 0.19, 0.16],
    [0.64, 0, 0, 0.13, 0.11],
    [0.68, 0, 0, 0.06, 0.05],
  ]);
  sculpt(upper, rib, [
    [0.355, 0, 0.01, 0.218, 0.198],
    [0.39, 0, 0.01, 0.222, 0.198],
  ]);
  oval(upper, pearl, 0, 0.6, 0.02, 0.17, 0.04, 0.15);
  oval(upper, blue, 0, 0.55, 0.17, 0.035, 0.03, 0.025);
  for (const side of [-1, 1]) {
    oval(upper, blue, side * 0.012, 0.5, 0.18, 0.012, 0.05, 0.012);
  }

  // 手臂是一节袖子加一只手：每帧把 arm 转向手的位置，袖子按肩到手的距离拉伸，手放在末端。
  const arms = [-1, 1].map((side) => {
    const arm = pivot(upper, side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    const sleeve = oval(arm, cream, 0, 0, 0, 0.08, 1, 0.08);
    const hand = oval(arm, skin, 0, 0, 0, 0.05, 0.05, 0.05);
    return { side, arm, sleeve, hand };
  });

  // 杯子：白色杯身加咖啡色的液面，由动作决定放在哪。
  const cup = pivot(upper, 0, 0, 0);
  // 和咖啡馆台面上的杯子一样大：杯身高 0.16、半径 0.1，原点在杯底往上 0.05。
  sculpt(cup, pearl, [
    [-0.05, 0, 0, 0.085, 0.085],
    [0.11, 0, 0, 0.1, 0.1],
  ]);
  oval(cup, "#7a4a32", 0, 0.11, 0, 0.085, 0.008, 0.085);

  const legs = [-1, 1].map((side) => {
    const leg = pivot(root, side * 0.09, 0.27, 0);
    oval(leg, pearl, 0, -0.12, 0.01, 0.065, 0.11, 0.07);
    oval(leg, brown, 0, -0.235, 0.035, 0.07, 0.045, 0.1);
    return { side, leg };
  });

  // 眼睛是始终朝向相机的贴片：任何角度都是完整的 3×4 像素，不会像脸部贴图那样在侧面被压扁。
  // 贴片挂在 root 上，不受头部缩放影响，尺寸始终等于像素尺寸。
  const eyes = [-1, 1].map((side) => {
    const textures = Object.fromEntries(
      Object.entries(eyeStamps).map(([name, stamp]) => [name, pixelTexture(stamp, side > 0)]),
    ) as Record<EyeShape, DataTexture>;
    const sprite = new Sprite(
      new SpriteMaterial({ map: textures.open, alphaTest: 0.5, depthWrite: false }),
    );
    sprite.scale.set(EYE_WIDTH * PIXEL, eyeStamps.open.length * PIXEL, 1);
    root.add(sprite);
    return { side, sprite, textures, anchor: new Vector3(), normal: new Vector3() };
  });

  // 情绪符号同样是对齐像素的贴片，画在最上层，不被帽子挡住。
  const emoteTextures = Object.fromEntries(
    Object.entries(emotes).map(([name, { frames }]) => [
      name,
      frames.map((frame) => pixelTexture(frame, false)),
    ]),
  ) as Record<EmoteName, DataTexture[]>;
  const emoteSprite = new Sprite(
    new SpriteMaterial({ alphaTest: 0.5, depthTest: false, depthWrite: false }),
  );
  emoteSprite.renderOrder = 1;
  root.add(emoteSprite);

  /**
   * 把贴片放到 anchor（头部局部坐标）投影后的位置，再在屏幕上右移 right、上移 up 个像素：
   * 中心对齐像素网格，然后朝相机前移 lift。width、height 是贴片的像素数。
   */
  function placeSprite(
    sprite: Sprite,
    anchor: Vector3,
    width: number,
    height: number,
    right: number,
    up: number,
    lift: number,
  ) {
    const view = head.localToWorld(anchor.clone()).applyMatrix4(camera.matrixWorldInverse);
    view.x = camera.left + Math.round((view.x - (width * PIXEL) / 2 - camera.left) / PIXEL) * PIXEL;
    view.x += (width * PIXEL) / 2 + right * PIXEL;
    view.y =
      camera.bottom + Math.round((view.y - (height * PIXEL) / 2 - camera.bottom) / PIXEL) * PIXEL;
    view.y += (height * PIXEL) / 2 + up * PIXEL;
    view.z += lift;
    sprite.position.copy(root.worldToLocal(view.applyMatrix4(camera.matrixWorld)));
    sprite.scale.set(width * PIXEL, height * PIXEL, 1);
  }
  /** 按造型参数算出眼睛在头部局部坐标里的锚点和朝向，正面看时眼睛落在贴图设计的格子上。 */
  function placeEyes(next: CharacterShape) {
    const left = EYE_COLUMN - next.eyeSpacing;
    const up =
      FACE_GRID * PIXEL * 0.5 - PIXEL * (EYE_ROW - next.eyeHeight + eyeStamps.open.length / 2);
    for (const eye of eyes) {
      const x = eye.side * (FACE_GRID * PIXEL * 0.5 - PIXEL * (left + EYE_WIDTH / 2));
      const surface = facePoint(x, up, 1);
      eye.normal
        .set(x / HEAD_HALF_WIDTH ** 2, surface.y / HEAD_RADIUS ** 2, surface.z / HEAD_RADIUS ** 2)
        .normalize();
      eye.anchor.copy(facePoint(x, up, EYE_DEPTH));
    }
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
  /** 脸部贴图上次画的嘴和腮红，变了才重画。 */
  let painted = "";

  function applyShape(next: CharacterShape) {
    shape = next;
    head.scale.setScalar(next.headSize / 100);
    hat.rotation.z = (-next.hatTilt * Math.PI) / 180;
    for (const { tail } of tails) {
      tail.scale.y = next.tailLength / 100;
    }
    painted = "";
    placeEyes(next);
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
      leg.position.y = 0.27 + 0.04 * Math.max(0, side * Math.cos(pose.step ?? 0)) * walk;
    }
    for (const { side, tail } of tails) {
      tail.rotation.x =
        0.05 * Math.sin(time * 1.6 - side) * (1 - walk) +
        (0.22 + 0.1 * Math.sin(2 * (pose.step ?? 0) - 1.2)) * walk;
      tail.rotation.z =
        side *
        ((shape.tailSpread * Math.PI) / 180 + 0.06 * Math.sin((pose.step ?? 0) - 0.8) * walk);
    }

    for (const [index, { side, arm, sleeve, hand }] of arms.entries()) {
      const reach = new Vector3(...pose.hands[index]).sub(arm.position);
      const length = reach.length();
      arm.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), reach.normalize());
      sleeve.position.y = -length * 0.43;
      sleeve.scale.y = length * 0.5;
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
    if (painted !== mouth + look.blush) {
      painted = mouth + look.blush;
      paintFace(shape, mouth, look.blush);
    }
    // 睁眼时每 3.85 秒眨一次。
    const eyeShape = pose.eyes ?? look.eyes;
    const blinking = eyeShape === "open" && time % 3.85 > 3.68;
    for (const eye of eyes) {
      eye.sprite.material.map = eye.textures[blinking ? "closed" : eyeShape];
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

      // 眼睛背对相机时隐藏；可见时把贴片对齐像素网格，再朝相机前移。
      root.updateMatrixWorld(true);
      const toCamera = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
      for (const eye of eyes) {
        const facing = eye.normal.clone().transformDirection(head.matrixWorld).dot(toCamera);
        eye.sprite.visible = facing > EYE_FACING;
        placeSprite(eye.sprite, eye.anchor, EYE_WIDTH, eyeStamps.open.length, 0, 0, EYE_LIFT);
      }

      // 一次性的情绪符号优先，冒出来后 0.5 秒内往上飘 3 像素；动作自带的符号原地显示。
      if (emote && time - emote.start > EMOTE_SECONDS) {
        emote = null;
      }
      const shown = emote
        ? { name: emote.name, age: time - emote.start }
        : pose.emote && { name: pose.emote, age: 0 };
      emoteSprite.visible = Boolean(shown);
      if (shown) {
        const frames = emoteTextures[shown.name];
        const texture = frames[Math.floor(time / 0.4) % frames.length];
        emoteSprite.material.map = texture;
        const { width, height } = texture.image;
        const rise = Math.floor(Math.min(shown.age, 0.5) * 6);
        placeSprite(
          emoteSprite,
          new Vector3(),
          width,
          height,
          EMOTE_OFFSET.right,
          EMOTE_OFFSET.up + rise,
          0,
        );
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
      faceMap.dispose();
      for (const eye of eyes) {
        eye.sprite.material.dispose();
        for (const texture of Object.values(eye.textures)) {
          texture.dispose();
        }
      }
      emoteSprite.material.dispose();
      for (const frames of Object.values(emoteTextures)) {
        for (const texture of frames) {
          texture.dispose();
        }
      }
    },
  };
}
