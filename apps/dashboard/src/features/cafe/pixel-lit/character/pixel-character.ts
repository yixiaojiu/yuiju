import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import {
  type ArtGrid,
  type CharacterDesign,
  defaultCharacterDesign,
  type EyeShape,
  faceLetters,
  type MouthShape,
  type OutfitName,
  type Part,
  type PixelArt,
  type Vec3,
} from "./character-design";
import { buildLolita } from "./outfits/lolita";
import { buildUniform } from "./outfits/uniform";
import { type PixelActionName, pixelActions } from "./pixel-actions";

/** 一个屏幕像素对应的世界尺寸。角色总高约 1.6，渲染出来大约 36 个像素。 */
export const PIXEL = 0.04;
/**
 * 默认的相机俯角，和光影喫茶店场景的 30° 俯视一致，角色放进场景时透视不会对不上。
 * 脸部贴图沿相机视线投影到头上，贴图格子和屏幕像素一一对应。
 * 场景可以临时换俯角（调光面板的「俯视角」），角色相机跟着换，像素对齐按相机实际的俯角算。
 */
export const ELEVATION = (30 * Math.PI) / 180;
/** 俯角为 elevation 时，身体整体上下移动 1 个屏幕像素需要的世界高度。上下起伏按它取整，脸部像素才不会错位。 */
function pixelRise(elevation: number) {
  return PIXEL / Math.cos(elevation);
}
/**
 * 情绪符号这类贴片所在的渲染层。角色相机默认能看到这一层；
 * 渲染法线这类只需要身体网格的场合，关掉这一层就能把贴片排除在外。
 */
export const OVERLAY_LAYER = 1;
/** 脸部贴图的边长（格），覆盖头部中心上下左右各 9 个像素的范围，头放大到 125% 也盖得住。 */
export const FACE_GRID = 18;
/** 上半身绕着转的腰部高度，鞠躬时上半身绕这里前倾。 */
const WAIST_Y = 0.375;
/**
 * 情绪符号中心相对头部中心投影位置的屏幕偏移（像素），在帽子右上方外面。
 * 按屏幕偏移而不是挂在头上，角色转到任何朝向时符号都在画面里同一个位置。
 */
const EMOTE_OFFSET = { right: 11, up: 15 };
/**
 * 自选色描边（sel-out）：描边不用一种固定的深色，而是把它包住的那个部件的颜色压暗、略偏紫，
 * 头发外是深棕、裙子外是深蓝；部件之间的内描边把靠后那一侧自己压暗（INNER_SHADE）。
 * 渲染目标里存的是线性颜色，乘这个系数约等于屏幕上压到原色的四成多。
 */
export const OUTLINE_SHADE = new Color(0.17, 0.12, 0.16);
/**
 * 部件之间的内描边：靠后那一侧自己的颜色压暗一档，屏幕上约为原色的六成，
 * 比外轮廓浅得多，头和衣服、手和裙子之间是同色系的过渡，不是一道黑线。
 */
export const INNER_SHADE = new Color(0.36, 0.3, 0.34);
/** 一次性情绪符号显示的秒数。 */
const EMOTE_SECONDS = 1.8;

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
  /** 手里拿的道具、它的位置和绕前后轴的倾斜（弧度，扫帚左右扫），为 null 时手里没东西。 */
  prop: { kind: PropName; at: Vec3; tilt: number } | null;
  /** 头左右平移的像素数（歪头）。头不倾斜，否则按屏幕贴的脸部像素画会和 3D 头发错开。 */
  headShift: number;
  /** 整个人在外面给的朝向上再多转的角度（弧度），转身看一眼。 */
  turn: number;
  /** 整个人连腿一起离地的像素数（跳起来）；rise 只抬身体，脚不离地。 */
  jump: number;
  /** 动作自带的情绪符号，比如思考时的「…」。 */
  emote: EmoteName | null;
  /** 马尾往后飘的程度：0 是站着、走路时的轻晃，1 是跑步时往后扬、随落脚颤动。 */
  tailFlow: number;
};

/** 动作里用到的道具：杯子、手机、小面包。 */
export type PropName = "cup" | "phone" | "bun" | "broom" | "notepad";

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
  aimPixelCamera(camera, width, height, focus, ELEVATION);
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
  elevation: number,
) {
  camera.left = (-width * PIXEL) / 2;
  camera.right = (width * PIXEL) / 2;
  camera.top = (height * PIXEL) / 2;
  camera.bottom = (-height * PIXEL) / 2;
  camera.updateProjectionMatrix();
  // 取景按默认设计的头部高度对准，编辑器改头的位置时画面不跟着跳。
  const center = snapToPixelGrid(
    new Vector3(
      focus.x,
      defaultCharacterDesign.parts.head.position[1] + focus.up * pixelRise(elevation),
      focus.z,
    ),
    elevation,
  );
  camera.position.set(
    center.x,
    center.y + 15 * Math.sin(elevation),
    center.z + 15 * Math.cos(elevation),
  );
  camera.lookAt(center);
  camera.layers.enable(OVERLAY_LAYER);
  // 角色每帧按相机矩阵对齐情绪符号的位置，渲染前就需要它。
  camera.updateMatrixWorld();
}

/**
 * 把角色的摆放位置对齐到像素网格：左右移动整像素，高度和前后各自在屏幕上移动整像素。
 * 0° 平视时前后移动不影响画面，前后不对齐。角色只在渲染时用对齐后的位置，逻辑位置可以连续变化。
 */
export function snapToPixelGrid(position: Vector3, elevation: number) {
  const depthStep = PIXEL / Math.sin(elevation);
  const rise = pixelRise(elevation);
  return new Vector3(
    Math.round(position.x / PIXEL) * PIXEL,
    Math.round(position.y / rise) * rise,
    elevation > 0 ? Math.round(position.z / depthStep) * depthStep : position.z,
  );
}

export type ExpressionName =
  | "normal"
  | "smile"
  | "happy"
  | "laugh"
  | "shy"
  | "surprised"
  | "sad"
  | "pout"
  | "sleepy"
  | "focused"
  | "wink";
/**
 * 一个表情：眼睛、嘴和腮红格数。rightEyes 只有眨眼这类左右眼不一样的表情才写，指画面右边那只眼睛；
 * 不写时两只眼睛相同（右眼是左眼的镜像）。动作可以临时指定眼睛和嘴，比如点头时闭眼。
 */
type Expression = {
  label: string;
  eyes: EyeShape;
  rightEyes?: EyeShape;
  mouth: MouthShape;
  blush: number;
};
export const expressions: Record<ExpressionName, Expression> = {
  normal: { label: "普通", eyes: "open", mouth: "line", blush: 2 },
  // 迎客、服务时的笑脸。
  smile: { label: "微笑", eyes: "open", mouth: "smile", blush: 2 },
  happy: { label: "开心", eyes: "happy", mouth: "smile", blush: 2 },
  laugh: { label: "大笑", eyes: "happy", mouth: "laugh", blush: 3 },
  shy: { label: "害羞", eyes: "shy", mouth: "line", blush: 3 },
  surprised: { label: "惊讶", eyes: "surprised", mouth: "open", blush: 2 },
  sad: { label: "难过", eyes: "droop", mouth: "frown", blush: 0 },
  // Q 版的生气：内眼角压下来，鼓着脸，腮红拉满。
  pout: { label: "生气", eyes: "sharp", mouth: "line", blush: 3 },
  sleepy: { label: "困倦", eyes: "sleepy", mouth: "line", blush: 1 },
  // 做饮品、擦杯子时。
  focused: { label: "专注", eyes: "narrow", mouth: "line", blush: 1 },
  wink: { label: "眨眼", eyes: "open", rightEyes: "closed", mouth: "smile", blush: 2 },
};

/**
 * 头顶的情绪符号，一个符号可以有几帧轮流显示。r/R 爱心，w/g 气泡和点（w 也是问号），y 感叹号和怒筋，
 * s/S 汗滴，n 音符和睡觉的 Z。
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
  // 白色问号，外圈的深色描边把它勾出来。
  question: { label: "？", frames: [[".ww.", "w..w", "...w", "..w.", "....", "..w."]] },
  // 四个拐角都朝着中心，拼成十字怒筋。
  anger: { label: "怒筋", frames: [[".y.y.", "yy.yy", ".....", "yy.yy", ".y.y."]] },
  // 一个 5 格的大 Z：再高会超出 64×64 画面的上沿，3 格的小 z 斜线会被描边吃掉。
  sleep: { label: "Z", frames: [["nnnnn", "...n.", "..n..", ".n...", "nnnnn"]] },
} satisfies Record<string, { label: string; frames: string[][] }>;
export type EmoteName = keyof typeof emotes;
/** 情绪符号的颜色。 */
const emotePalette: Record<string, string> = {
  r: "#ff6f96",
  R: "#ffc4d6",
  w: "#ffffff",
  g: "#6b5a66",
  y: "#ff5d4a",
  s: "#69bdf0",
  S: "#d6f1ff",
  n: "#8a63c9",
};
const degree = Math.PI / 180;
const still: Vec3 = [0, 0, 0];
/** 不开放编辑的小部件（帽顶的小球、丝带结、发夹、杯子、围裙结）用固定的位置和尺寸。 */
function fixed(position: Vec3, size: Vec3): Part {
  return { position, size, rotation: still };
}
/** 按部件数据摆好 object；side 为 -1 时左右镜像：位置 x、绕 y 和 z 的旋转取反。 */
function arrange<T extends Object3D>(object: T, part: Part, side = 1) {
  object.position.set(part.position[0] * side, part.position[1], part.position[2]);
  object.rotation.set(
    part.rotation[0] * degree,
    part.rotation[1] * degree * side,
    part.rotation[2] * degree * side,
  );
  object.scale.set(...part.size);
  return object;
}

/** 一圈截面：高度、中心 x、中心 z、左右和前后两个半径。一个形状的截面从下往上排。 */
export type Ring = [number, number, number, number, number];

/** 裙子上一圈竖向的褶：count 道，半径起伏 depth（相对半径的比例）。 */
export type Folds = { count: number; depth: number };

/**
 * 按一圈圈截面连成的闭合形状，上下封口。folds 让每圈半径按角度起伏出竖向的褶，
 * 褶的朝向各不相同，受光后自然分出亮面和暗面的褶痕。正前方落在褶沟里：
 * 落在褶峰上时，正前方最凸，裙摆底边正中会多顶出一个像素。
 */
function volume(rings: Ring[], folds: Folds) {
  const positions: number[] = [],
    indices: number[] = [];
  const segments = 40;
  for (const [row, [y, x, z, rx, rz]] of rings.entries()) {
    for (let i = 0; i <= segments; i++) {
      const angle = ((i / segments) * 2 - 1) * Math.PI;
      const fold = 1 - folds.depth * Math.cos(angle * folds.count);
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
 * 衣服搭建时能用的挂载点和建模函数。衣服的部件都挂在 attach 出来的组上，切换衣服时这些组整体显隐。
 * upper 是上半身（随鞠躬前倾），skirt 是裙子的转轴（走路时左右扭），
 * legs 是两条腿的胯部转轴（挂鞋），按画面左、右（side 为 -1、1）排。
 * 坐标都以脚底为原点，+Z 朝前；左右对称的部件按画面右边那一个摆，side 为 -1 时镜像。
 */
export type OutfitKit = {
  attach: (parent: Group) => Group;
  upper: Group;
  skirt: Group;
  legs: Group[];
  oval: (parent: Group, color: string, part: Part, variant?: "soft", side?: number) => Mesh;
  block: (parent: Group, color: string, part: Part, side?: number) => Mesh;
  place: (parent: Group, part: Part, side?: number) => Group;
  sculpt: (parent: Group, color: string, rings: Ring[], variant?: "soft", folds?: Folds) => Mesh;
  fixed: (position: Vec3, size: Vec3) => Part;
  /**
   * 给 mesh 贴一张像素画（贴花）：透明格露出 color，其他格按 palette 上色；anchor 是像素画中心在 mesh 自身坐标里的位置。
   */
  decal: (
    mesh: Mesh,
    color: string,
    art: PixelArt,
    palette: Record<string, string>,
    anchor: Vec3,
  ) => void;
};
/**
 * 衣服搭好后交给角色的东西。
 * showLegs 为 false 时整条腿不画：长到地面的裙子在走路起伏时会被抬起来，腿留在地上会从裙摆下露出来。
 */
export type OutfitBuild = { showLegs: boolean };

/**
 * 按 design 搭建约 1.8 头身的像素角色，脚底在原点，正面朝 +Z。只保证正面、背面、左右侧面四个朝向渲染正常。
 * 造型改了就重新创建一个。camera 是 createPixelCamera 给出的相机，每帧用它把情绪符号对齐到像素网格。
 */
export function createPixelCharacter(
  camera: OrthographicCamera,
  design: CharacterDesign,
  outfit: OutfitName,
) {
  const { colors, parts } = design;
  const root = new Group();
  // 整个人（身体和腿）的转轴：跳起来时整体离地，转身看时整体多转一个角度；朝向由外面设在 root 上。
  const whole = pivot(root, 0, 0, 0);
  // 身体（含头）整体按像素起伏；腿留在 whole 上，起伏时脚不离地。
  const body = pivot(whole, 0, 0, 0);
  // 上半身绕腰前倾：waist 在腰部高度转动，upper 再移回原点，上半身的部件仍按脚底为原点摆放。
  const waist = pivot(body, 0, WAIST_Y, 0);
  const upper = pivot(waist, 0, -WAIST_Y, 0);
  const head = arrange(new Group(), parts.head);
  upper.add(head);

  /** 这个角色建的所有像素画贴图，dispose 时一起释放。 */
  const artTextures: DataTexture[] = [];
  /**
   * 把一张字符画写进贴图：palette 里有的字母画成对应颜色，没有的（比如 .）是透明格。
   * DataTexture 的第一行在贴图底部，所以倒着写入。贴图已有时原地重写（脸随表情重画）。
   */
  function paintTexture(
    rows: readonly string[],
    palette: Record<string, string>,
    existing?: DataTexture,
  ) {
    const width = rows[0].length,
      height = rows.length;
    const texture = existing ?? new DataTexture(new Uint8Array(width * height * 4), width, height);
    if (!existing) {
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = texture.minFilter = NearestFilter;
      artTextures.push(texture);
    }
    const data = texture.image.data as Uint8Array;
    for (const [row, line] of rows.entries()) {
      for (const [column, cell] of [...line].entries()) {
        const color = palette[cell];
        const rgb = color ? parseInt(color.slice(1), 16) : 0;
        data.set(
          [rgb >> 16, (rgb >> 8) & 255, rgb & 255, color ? 255 : 0],
          ((height - 1 - row) * width + column) * 4,
        );
      }
    }
    texture.needsUpdate = true;
    return texture;
  }
  /** 一个朝向的贴图，它的格数，以及锚点落在画布上的位置（从左上角数，单位是格）。 */
  type ArtView = { texture: DataTexture; size: Vector2; origin: Vector2 };
  type ArtTextures = { front: ArtView; side: ArtView; back: ArtView };
  function artViewOf(grid: ArtGrid, palette: Record<string, string>): ArtView {
    return {
      texture: paintTexture(grid.rows, palette),
      size: new Vector2(grid.rows[0].length, grid.rows.length),
      origin: new Vector2(...grid.origin),
    };
  }
  function artTexturesOf(art: PixelArt, palette: Record<string, string>): ArtTextures {
    return {
      front: artViewOf(art.front, palette),
      side: artViewOf(art.side, palette),
      back: artViewOf(art.back, palette),
    };
  }

  // 脸是一张 FACE_GRID 见方的像素画，随表情重画；背面被头发挡住，背面贴图直接用正面的。
  const facePalette = Object.fromEntries(
    Object.entries(faceLetters).map(([letter, name]) => [letter, colors[name]]),
  );
  const blankFace = Array.from({ length: FACE_GRID }, () => ".".repeat(FACE_GRID));
  const frontFace = paintTexture(blankFace, facePalette),
    sideFace = paintTexture(blankFace, facePalette);
  const faceView = (texture: DataTexture): ArtView => ({
    texture,
    size: new Vector2(FACE_GRID, FACE_GRID),
    origin: new Vector2(FACE_GRID / 2, FACE_GRID / 2),
  });
  const faceArt: ArtTextures = {
    front: faceView(frontFace),
    side: faceView(sideFace),
    back: faceView(frontFace),
  };

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
  /**
   * 按当前的眼睛、嘴和腮红，重画正面和侧面两张脸。eyes 是画面左边那只眼睛，rightEyes 是右边那只，
   * 右眼按镜像盖上去，下垂、上挑这类有方向的眼睛两边对称。侧面只看得到一只眼睛，用 eyes。
   */
  function paintFace(eyes: EyeShape, rightEyes: EyeShape, mouth: MouthShape, blush: number) {
    const { face } = design;
    const eye = design.eyes[eyes];
    const eyeWidth = eye.front[0].length;
    const top = face.eyeRow,
      left = face.eyeColumn,
      right = FACE_GRID - face.eyeColumn - eyeWidth;

    const front = face.front.map((row) => [...row]);
    // 腮红在眼睛下面紧挨的一行，从外眼角外侧一格往里画 blush 格。
    const blushRow = top + eye.front.length;
    for (let k = 0; k < blush; k++) {
      front[blushRow][left - 1 + k] = front[blushRow][right + eyeWidth - k] = "b";
    }
    stamp(front, eye.front, top, left);
    stamp(
      front,
      design.eyes[rightEyes].front.map((row) => [...row].reverse().join("")),
      top,
      right,
    );
    // 嘴按整数格左右居中，嘴宽是奇数时偏左半格。
    const mouthStamp = design.mouths[mouth].front;
    stamp(front, mouthStamp, face.mouthRow, Math.floor((FACE_GRID - mouthStamp[0].length) / 2));
    paintTexture(
      front.map((cells) => cells.join("")),
      facePalette,
      frontFace,
    );

    const side = face.side.map((row) => [...row]);
    // 侧面的腮红在眼睛下面紧挨的一行，从眼睛前缘往后画 blush 格。
    for (let k = 0; k < blush; k++) {
      side[top + eye.side.length][face.sideEyeColumn + 1 - k] = "b";
    }
    stamp(side, eye.side, top, face.sideEyeColumn);
    stamp(side, design.mouths[mouth].side, face.mouthRow, face.sideMouthColumn);
    paintTexture(
      side.map((cells) => cells.join("")),
      facePalette,
      sideFace,
    );
  }

  const materials = new Map<string, ShaderMaterial>();
  /** 自带的两档明暗：1 打开，0 只输出底色（放进有真实灯光的场景时，由场景光照决定明暗）。所有材质共用。 */
  const celShading = { value: 1 };
  /** 两档明暗共用的光照方向（相机空间，亮面始终在画面左上）和暗面颜色倍率。 */
  const celLight = `
    float d=dot(normalize(vNormal),normalize(vec3(-.45,.75,.5)));
    vec3 shadow=vec3(.84,.74,.8);`;
  /**
   * 两档明暗的卡通材质。光照方向固定在相机空间，角色转身时亮面始终在画面左上。
   * variant 为 soft 时只在背光很重的边缘画暗色，头发、袖子基本是一整块纯色。
   */
  function cel(color: string, variant?: "soft") {
    const key = variant ? variant + color : color;
    const existing = materials.get(key);
    if (existing) {
      return existing;
    }
    const material = new ShaderMaterial({
      uniforms: { pigment: { value: new Color(color) }, celShading },
      defines: variant === "soft" ? { SOFT_SHADOW: 1 } : {},
      vertexShader: `
        varying vec3 vNormal;
        void main(){
          vNormal=normalMatrix*normal;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }`,
      fragmentShader: `
        uniform vec3 pigment; uniform float celShading;
        varying vec3 vNormal;
        void main(){
          ${celLight}
          float edge=.08;
          #ifdef SOFT_SHADOW
          edge=-.35;
          #endif
          gl_FragColor=vec4(d < edge ? mix(pigment,pigment*shadow,celShading) : pigment,1.);
          #include <colorspace_fragment>
        }`,
    });
    materials.set(key, material);
    return material;
  }

  /**
   * 投影像素画材质：一张像素画沿相机视线投影到部件上，贴图一格正好是一个屏幕像素，转身、做动作时跟着部件走。
   * 脸、手、衣服上的图案都用它，比用几何体拼出 1 像素的细节准得多。
   * - anchor：像素画中心在部件自身坐标里的位置。
   * - 镜头从正面、侧面、背面看时分别用三张贴图；侧面朝左时左右翻转，让侧面图最后一列始终朝前。
   *   mirror 为 -1 时正面和背面也左右翻转（画面左边那只手用右手的像素画）。
   * - cutout 为 false 是贴花：透明格露出部件本来的颜色 color；为 true 是剪影：透明格挖空，形状完全由像素画决定。
   * - edge 是两档明暗的分界，越小暗面越少。
   */
  function projected({
    color,
    art,
    anchor,
    cutout,
    mirror,
    edge,
  }: {
    color: string;
    art: ArtTextures;
    anchor: Vector3;
    cutout: boolean;
    mirror: number;
    edge: number;
  }) {
    const material = new ShaderMaterial({
      uniforms: {
        pigment: { value: new Color(color) },
        frontMap: { value: art.front.texture },
        sideMap: { value: art.side.texture },
        backMap: { value: art.back.texture },
        sizes: { value: [art.front.size, art.side.size, art.back.size] },
        origins: { value: [art.front.origin, art.side.origin, art.back.origin] },
        pixel: { value: PIXEL },
        anchor: { value: anchor },
        mirror: { value: mirror },
        edge: { value: edge },
        celShading,
      },
      defines: cutout ? { CUTOUT: 1 } : {},
      vertexShader: `
        uniform vec3 anchor; uniform float mirror;
        varying vec3 vNormal; varying vec3 vArt;
        void main(){
          vNormal=normalMatrix*normal;
          // xy 是这个点离像素画中心的屏幕偏移；z 是用哪张图：0 正面、1 侧面、2 背面。
          vec3 offset=mat3(modelViewMatrix)*(position-anchor);
          vec3 toCamera=vec3(modelViewMatrix[0][2],modelViewMatrix[1][2],modelViewMatrix[2][2]);
          float view=abs(toCamera.x)>=abs(toCamera.z) ? 1. : (toCamera.z>0. ? 0. : 2.);
          float flip=view==1. ? sign(modelViewMatrix[2][0]) : mirror;
          vArt=vec3(offset.x*flip,offset.y,view);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }`,
      fragmentShader: `
        uniform vec3 pigment; uniform sampler2D frontMap; uniform sampler2D sideMap; uniform sampler2D backMap;
        uniform vec2 sizes[3]; uniform vec2 origins[3]; uniform float pixel; uniform float edge; uniform float celShading;
        varying vec3 vNormal; varying vec3 vArt;
        void main(){
          int view=int(vArt.z+.5);
          // 这个点落在画布的哪一格：从锚点所在的位置按屏幕偏移数过去（画布 y 往下）。
          vec2 cell=origins[view]+vec2(vArt.x,-vArt.y)/pixel;
          vec2 uv=vec2(cell.x,sizes[view].y-cell.y)/sizes[view];
          vec4 texel=view==0 ? texture2D(frontMap,uv) : view==1 ? texture2D(sideMap,uv) : texture2D(backMap,uv);
          // 画布范围外的地方算透明。
          float painted=uv.x>=0. && uv.x<1. && uv.y>=0. && uv.y<1. ? texel.a : 0.;
          #ifdef CUTOUT
          if(painted<.5)discard;
          #endif
          vec3 base=painted>.5 ? texel.rgb : pigment;
          ${celLight}
          gl_FragColor=vec4(d < edge ? mix(base,base*shadow,celShading) : base,1.);
          #include <colorspace_fragment>
        }`,
    });
    materials.set(`art${materials.size}`, material);
    return material;
  }
  const sphere = new SphereGeometry(1, 24, 16),
    box = new BoxGeometry(1, 1, 1);
  function oval(parent: Group, color: string, part: Part, variant?: "soft", side = 1) {
    const mesh = arrange(new Mesh(sphere, cel(color, variant)), part, side);
    parent.add(mesh);
    return mesh;
  }
  /** 方块部件：领片、领结、发夹、鞋子。 */
  function block(parent: Group, color: string, part: Part, side = 1) {
    const mesh = arrange(new Mesh(box, cel(color)), part, side);
    parent.add(mesh);
    return mesh;
  }
  /** 一组部件的转轴，按部件数据整体移动、旋转、缩放。 */
  function place(parent: Group, part: Part, side = 1) {
    const group = arrange(new Group(), part, side);
    parent.add(group);
    return group;
  }
  function sculpt(
    parent: Group,
    color: string,
    rings: Ring[],
    variant?: "soft",
    folds: Folds = { count: 0, depth: 0 },
  ) {
    const mesh = new Mesh(volume(rings, folds), cel(color, variant));
    parent.add(mesh);
    return mesh;
  }

  // 头和脸：脸部贴图按屏幕像素投影在脸上，头发外壳向后偏，正面只露出刘海以下。
  // 脸是「麻薯」形：上半部分接近球（被头发和刘海盖着），下半部分加宽，最宽处在眼睛下面到嘴巴之间，
  // 下巴是圆弧，30° 俯视时脸颊肉嘟嘟的，不会收成尖下巴。截面按单位大小给，parts.face 整体缩放。
  head.add(
    arrange(
      new Mesh(
        volume(
          [
            [-1, 0.02],
            [-0.97, 0.38],
            [-0.9, 0.66],
            [-0.75, 0.88],
            [-0.5, 0.99],
            [-0.2, 1.02],
            [0.1, 1],
            [0.4, 0.92],
            [0.7, 0.71],
            [0.9, 0.44],
            [1, 0.02],
          ].map(([y, radius]): Ring => [y, 0, 0, radius, radius]),
          { count: 0, depth: 0 },
        ),
        projected({
          color: colors.skin,
          art: faceArt,
          anchor: new Vector3(),
          cutout: false,
          mirror: 1,
          edge: -0.4,
        }),
      ),
      parts.face,
    ),
  );
  // 头发外壳在额头上方往后退开，额头到眼睛上方的刘海由脸部贴图画。
  oval(head, colors.hair, parts.hairShell, "soft");
  // 后脑的短发薄薄一层，下沿收在领口上方，背面不压住衣服，露出完整的领口和水手领；两侧在脸颊旁鼓出一点，头的轮廓是圆的。
  oval(head, colors.hair, parts.nape, "soft");
  // 鬓发上宽下尖，从耳前笔直垂到下巴下面，挂在脸颊外侧、不往里收，正面看下巴两边露出空隙；
  // 侧面看挡在眼睛后面，脸只露出前面几列。
  for (const side of [-1, 1]) {
    sculpt(
      place(head, parts.sideLock, side),
      colors.hair,
      [
        [-0.32, side * 0.29, 0.05, 0.008, 0.008],
        [-0.26, side * 0.29, 0.05, 0.028, 0.03],
        [-0.12, side * 0.29, 0.05, 0.04, 0.045],
        [0.02, side * 0.285, 0.04, 0.045, 0.05],
        [0.14, side * 0.27, 0.03, 0.04, 0.045],
        [0.2, side * 0.25, 0, 0.02, 0.02],
      ],
      "soft",
    );
  }
  // 方形发夹别在屏幕右侧、右眼上方的刘海上：2×2 像素的浅蓝方块，外侧伸出 2 像素的白色夹子。
  // 整体按俯角转向镜头，再顺着头的弧度往外侧转，贴住头的表面：白夹子悬空时和后面的头发前后差得远，
  // 会被描上一圈深色内描边。侧面看只剩一条细线。
  const clip = place(head, parts.clip);
  block(clip, colors.clip, fixed(still, [0.07, 0.07, 0.02]));
  block(clip, colors.pearl, fixed([0.07, 0.017, 0], [0.07, 0.035, 0.015]));

  // 贝雷帽：蓬起来的圆顶，比头窄一点，平扣在头顶、稍微偏后，不压住额头和两侧，头的轮廓保持圆的。
  const hat = place(head, parts.hat);
  sculpt(hat, colors.pearl, [
    [-0.02, 0, 0, 0.27, 0.26],
    [0.03, 0, 0, 0.33, 0.32],
    [0.08, 0, 0, 0.34, 0.33],
    [0.14, 0, 0, 0.3, 0.29],
    [0.19, 0, 0, 0.2, 0.19],
    [0.22, 0, 0, 0.06, 0.06],
  ]);
  oval(hat, colors.pearl, fixed([0, 0.22, 0], [0.025, 0.025, 0.025]));

  const tails = [-1, 1].map((side) => {
    // 马尾系在头顶两侧偏后、帽檐下面，先往外张开再垂下，到裙子中段；颜色比头发深一档。
    // 系结点决定位置和收拢角度，马尾本身按尺寸缩放（y 是长度）。马尾笔直下垂、不往后弯，侧面看挂在身体后半边。
    const tie = arrange(new Group(), { ...parts.tail, size: [1, 1, 1] }, side);
    head.add(tie);
    const tail = pivot(tie, 0, 0, 0);
    tail.scale.set(...parts.tail.size);
    sculpt(
      tail,
      colors.tailHair,
      [
        [-0.95, side * 0.15, -0.05, 0.015, 0.015],
        [-0.86, side * 0.17, -0.05, 0.045, 0.04],
        [-0.6, side * 0.19, -0.05, 0.065, 0.055],
        [-0.32, side * 0.17, -0.05, 0.07, 0.06],
        [-0.08, side * 0.08, -0.03, 0.07, 0.06],
        [0.04, side * 0.02, 0, 0.05, 0.045],
        [0.08, 0, 0, 0.02, 0.02],
      ],
      "soft",
    );
    // 马尾根部的蓝丝带：上下两个小圈比马尾根部稍粗，正面、侧面、背面都把根部盖住。
    const bow = place(tie, parts.ribbonBow, side);
    for (const lobe of [-1, 1]) {
      oval(bow, colors.ribbon, fixed([side * 0.035, lobe * 0.045, -0.01], [0.06, 0.05, 0.065]));
    }
    // 结下垂着前后两条 1 像素宽的丝带，顺着马尾的中线贴在前后表面上，背面也看得到；
    // 后面那条短一点，两条不对齐。挂在马尾上跟着一起摆。
    const strips = place(tail, parts.ribbonStrip, side);
    sculpt(strips, colors.ribbon, [
      [-0.22, side * 0.16, 0.04, 0.018, 0.012],
      [-0.126, side * 0.11, 0.05, 0.018, 0.012],
      [-0.031, side * 0.045, 0.065, 0.018, 0.012],
    ]);
    sculpt(strips, colors.ribbon, [
      [-0.19, side * 0.145, -0.135, 0.018, 0.012],
      [-0.126, side * 0.11, -0.125, 0.018, 0.012],
      [-0.031, side * 0.045, -0.09, 0.018, 0.012],
    ]);
    return { side, tail };
  });

  // 裙子的转轴：走路时左右扭，各套衣服的裙子挂在它下面。
  const skirt = pivot(body, 0, 0, 0);

  // 不画手臂，手是两个肤色小球，每帧直接放到动作给出的位置。
  // 三十几个像素的角色上，两三像素宽的手臂看不清，横在身前只会添杂线；手是球，动作想放哪就放哪。
  // 手的颜色和形状全由像素画决定（剪影），小球只管位置和前后遮挡；画面左边那只手用镜像的像素画。
  const handArt = artTexturesOf(design.handArt, { s: colors.skin, S: colors.legSkin });
  const hands = [-1, 1].map((side) => {
    const hand = new Mesh(
      sphere,
      projected({
        color: colors.skin,
        art: handArt,
        anchor: new Vector3(),
        cutout: true,
        mirror: side,
        edge: -0.4,
      }),
    );
    arrange(hand, fixed(still, parts.hand.size));
    upper.add(hand);
    return { side, hand };
  });

  // 腿从裙子里的胯部开始，平时藏在裙子下面，走路、坐下抬腿时才露出来；
  // 比脸深一档的肤色像是在裙子的阴影里。鞋由衣服提供。
  const legs = [-1, 1].map((side) => {
    const leg = place(whole, parts.hip, side);
    const skin = oval(leg, colors.legSkin, parts.leg, undefined, side);
    return { side, leg, skin };
  });

  /** 搭一套衣服，记下它挂出来的组（切换时整体显隐）和它的袖子。 */
  function wear(build: (kit: OutfitKit) => OutfitBuild) {
    const groups: Group[] = [];
    const { showLegs } = build({
      attach(parent) {
        const group = pivot(parent, 0, 0, 0);
        groups.push(group);
        return group;
      },
      upper,
      skirt,
      legs: legs.map(({ leg }) => leg),
      oval,
      block,
      place,
      sculpt,
      fixed,
      decal(mesh, color, art, palette, anchor) {
        mesh.material = projected({
          color,
          art: artTexturesOf(art, palette),
          anchor: new Vector3(...anchor),
          cutout: false,
          mirror: 1,
          edge: 0.08,
        });
      },
    });
    return { groups, showLegs };
  }
  const outfits: Record<OutfitName, ReturnType<typeof wear>> = {
    uniform: wear((kit) => buildUniform(kit, design.outfits.uniform)),
    lolita: wear((kit) => buildLolita(kit, design.outfits.lolita)),
  };
  /** 当前穿的衣服：决定显示哪一组部件、腿要不要画，以及站着时手放在哪。 */
  let wearing = outfit;
  /** 只显示 name 这一套衣服。 */
  function setOutfit(name: OutfitName) {
    wearing = name;
    for (const [key, { groups }] of Object.entries(outfits)) {
      for (const group of groups) {
        group.visible = key === name;
      }
    }
    for (const { skin } of legs) {
      skin.visible = outfits[name].showLegs;
    }
  }
  setOutfit(outfit);

  // 道具都挂在上半身上，跟着前倾；动作每帧决定显示哪一个、放在哪。
  // 杯子：白色杯身加咖啡色的液面。
  const cup = pivot(upper, 0, 0, 0);
  // 和咖啡馆台面上的杯子一样大：杯身高 0.16、半径 0.1，原点在杯底往上 0.05。
  sculpt(cup, colors.pearl, [
    [-0.05, 0, 0, 0.085, 0.085],
    [0.11, 0, 0, 0.1, 0.1],
  ]);
  oval(cup, "#7a4a32", fixed([0, 0.11, 0], [0.085, 0.008, 0.085]));
  // 手机：竖着的小方块，屏幕朝着她自己，镜头看到的是粉色手机壳；上沿往她那边倾。约 2×3 像素。
  const phone = pivot(upper, 0, 0, 0);
  phone.rotation.x = -0.5;
  block(phone, "#f4a6c0", fixed(still, [0.08, 0.12, 0.015]));
  // 小圆面包：焦糖色的扁圆，约 2×2 像素。
  const bun = pivot(upper, 0, 0, 0);
  oval(bun, "#d9944f", fixed(still, [0.05, 0.035, 0.05]));
  // 扫帚：原点在两只手之间，细木杆往下伸到脚边，末端是浅色的扫帚头；绕原点左右倾斜就是在扫地。
  const broom = pivot(upper, 0, 0, 0);
  // 下端往前斜：扫帚头落在裙摆前面，不被蓬蓬裙盖住。
  broom.rotation.x = -0.35;
  block(broom, "#9c6b45", fixed([0, -0.17, 0], [0.025, 0.5, 0.025]));
  block(broom, "#d8b878", fixed([0, -0.43, 0.01], [0.13, 0.07, 0.05]));
  // 小本子：奶白色的小方块，和手机一样往她那边倾，约 2×3 像素。
  const notepad = pivot(upper, 0, 0, 0);
  notepad.rotation.x = -0.5;
  block(notepad, colors.pearl, fixed(still, [0.1, 0.11, 0.015]));
  const props: Record<PropName, Group> = { cup, phone, bun, broom, notepad };

  // 情绪符号是对齐像素的贴片，画在最上层，不被帽子挡住。
  const emoteTextures = Object.fromEntries(
    Object.entries(emotes).map(([name, { frames }]) => [
      name,
      frames.map((frame) => paintTexture(frame, emotePalette)),
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

  function applyPose(pose: PixelPose, time: number) {
    // 俯角按相机的实际朝向算：场景临时换俯角时，起伏仍是整像素。
    const rise = pixelRise(Math.asin(-camera.getWorldDirection(new Vector3()).y));
    body.position.y = pose.rise * rise;
    waist.rotation.x = pose.lean;
    // 头跟着上身移到前面，但自己保持竖直：脸部像素画按屏幕贴在头上，不跟着头转，
    // 头一倾斜，3D 的头发、鬓毛和脸部像素画就会错开半格，五官缺行少列。
    head.rotation.x = -pose.lean;
    head.position.y = parts.head.position[1] - pose.headDrop * rise;
    head.position.x = parts.head.position[0] + pose.headShift * PIXEL;
    whole.position.y = pose.jump * rise;
    whole.rotation.y = pose.turn;

    const walk = pose.step === null ? 0 : 1;
    const beat = Math.sin(pose.step ?? 0);
    // 小碎步：腿前后摆得小、脚抬得低，裙子跟着轻轻扭。
    skirt.rotation.y = 0.05 * beat * walk;
    for (const { side, leg } of legs) {
      leg.rotation.x = pose.seated ? -1.45 : side * 0.3 * beat * walk;
      leg.position.y =
        parts.hip.position[1] + 0.025 * Math.max(0, side * Math.cos(pose.step ?? 0)) * walk;
    }
    const step = pose.step ?? 0;
    const flow = pose.tailFlow;
    for (const { side, tail } of tails) {
      // 站着时马尾轻轻晃；走路时只往后仰一点、跟着步子晃，不往后甩；
      // 跑步时往后扬，每落一次脚（步伐相位的两倍）上下颤一下，左右两条错开一点。
      const stood = 0.05 * Math.sin(time * 1.6 - side);
      const walked = 0.06 + 0.04 * Math.sin(2 * step - 1.2);
      const ran = 0.3 + 0.08 * Math.sin(2 * step - 1.2 + side * 0.4);
      tail.rotation.x = stood * (1 - walk) + (walked * (1 - flow) + ran * flow) * walk;
      tail.rotation.z = side * (0.06 + 0.03 * flow) * Math.sin(step - 0.8) * walk;
    }

    // 手直接放到动作给出的位置；走路时也不摆。
    for (const [index, { hand }] of hands.entries()) {
      hand.position.set(...pose.hands[index]);
    }

    for (const [name, prop] of Object.entries(props)) {
      prop.visible = pose.prop?.kind === name;
    }
    if (pose.prop) {
      props[pose.prop.kind].position.set(...pose.prop.at);
      props[pose.prop.kind].rotation.z = pose.prop.tilt;
    }

    const look = expressions[expression];
    const mouth = pose.mouth ?? look.mouth;
    // 睁眼时每 3.85 秒眨一次；动作指定了眼睛时两只眼睛都用它。
    const blinking = time % 3.85 > 3.68;
    const blink = (wanted: EyeShape) => (wanted === "open" && blinking ? "closed" : wanted);
    const eyes = blink(pose.eyes ?? look.eyes);
    const rightEyes = blink(pose.eyes ?? look.rightEyes ?? look.eyes);
    const key = [eyes, rightEyes, mouth, look.blush].join();
    if (painted !== key) {
      painted = key;
      paintFace(eyes, rightEyes, mouth, look.blush);
    }
  }

  return {
    root,
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
    setOutfit,
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
        ? pixelActions[oneShot.name].pose(time - oneShot.start, design.outfits[wearing].restHand)
        : pixelActions[looping].pose(time - loopStart, design.outfits[wearing].restHand);
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
      for (const texture of artTextures) {
        texture.dispose();
      }
      emoteSprite.material.dispose();
    },
  };
}
