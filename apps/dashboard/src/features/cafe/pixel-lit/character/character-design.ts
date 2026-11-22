/**
 * 像素店员的造型数据。身体（发型、脸、手脚、贝雷帽、待机手位）各套衣服共用；
 * 每套衣服有自己的颜色和部件，搭建代码在 outfits/ 下各一个文件。
 * /cafe/pixel-character 的编辑器实时修改它，调满意后点「复制改动」（只含和这里默认值不同的部分），把 JSON 写回这里的默认值。
 */
export type Vec3 = readonly [number, number, number];

/**
 * 部件的摆放：相对父级的位置、尺寸、旋转（角度）。尺寸对椭球是三个半径，对方块是长宽高，
 * 对一组部件是整体缩放。左右对称的部件按画面右边（角色左手边，+X）那一个填，另一边镜像。
 * 有的部件只用其中一两项，编辑器只显示用得到的。
 */
export type Part = { position: Vec3; size: Vec3; rotation: Vec3 };

export type EyeShape = "open" | "closed" | "happy" | "shy" | "surprised";
export type MouthShape = "line" | "smile" | "open";

/** 身体的颜色：发色、肤色、贝雷帽和发夹、马尾丝带，以及脸部贴图用到的颜色。 */
export type BodyColorName =
  | "hair"
  | "tailHair"
  | "skin"
  | "legSkin"
  | "pearl"
  | "ribbon"
  | "clip"
  | "lash"
  | "pupilDark"
  | "pupil"
  | "pupilLight"
  | "highlight"
  | "blush"
  | "lip"
  | "mouth";

export type BodyPartName =
  | "head"
  | "face"
  | "hairShell"
  | "nape"
  | "sideLock"
  | "clip"
  | "hat"
  | "tail"
  | "ribbonBow"
  | "ribbonStrip"
  | "hand"
  | "hip"
  | "leg";

export type OutfitName = "uniform" | "lolita";
export const outfitLabels: Record<OutfitName, string> = { uniform: "制服", lolita: "洛丽塔" };

/** 制服：黄毛衣、水手领、蓝色长裙、乐福鞋。 */
export type UniformDesign = {
  /** 站着时画面右边那只手的位置（上半身空间，脚底为原点，+Z 朝前），另一只手镜像。裙子形状不同，手位各自一份。 */
  restHand: Vec3;
  colors: Record<
    "sweater" | "rib" | "collar" | "knot" | "skirt" | "skirtBand" | "gold" | "shoe",
    string
  >;
  parts: Record<
    "skirt" | "sweater" | "collar" | "knot" | "collarFlap" | "collarTrim" | "shoe",
    Part
  >;
};

/**
 * 洛丽塔：主色比头发深一档，窄直筒上身配腰下立刻张开的蓬蓬裙，裙子上有柔和的竖褶；
 * 胸前的蝴蝶结和丝带是一张贴在上身的像素画（chestArt），a 点缀色、A 点缀色压暗一档、. 透明（露出衣服）。
 */
export type LolitaDesign = {
  restHand: Vec3;
  colors: Record<"dress" | "accent" | "trim" | "shoe", string>;
  /** 胸前像素画的中心（上身空间），像素画按相机方向投影到上身上。 */
  chestArt: PixelArt;
  parts: Record<"dress" | "bodice" | "chest" | "collar" | "collarFlap" | "shoe", Part>;
};

/** 一个图案在正面、侧面各一份。侧面按脸朝屏幕右边画。 */
export type FacePattern = { front: string[]; side: string[] };
/**
 * 一个朝向的像素画：rows 从上到下一行一个字符串；origin 是部件上的锚点落在画布的哪个位置
 * （从画布左上角数，x 往右、y 往下，单位是格，可以是半格）。画布往左、往上扩展时原点跟着挪，画好的内容在角色身上不动。
 */
export type ArtGrid = { rows: string[]; origin: [number, number] };
/**
 * 按相机方向投影到部件上的像素画，贴图一格正好是一个屏幕像素，正面、侧面、背面各一份，尺寸可以不同。
 * 侧面按朝屏幕右边画，朝左时自动左右翻转。
 */
export type PixelArt = { front: ArtGrid; side: ArtGrid; back: ArtGrid };

export type CharacterDesign = {
  colors: Record<BodyColorName, string>;
  face: FacePattern & {
    /** 眼睛最上一行所在的贴图行。 */
    eyeRow: number;
    /** 正面左眼的起始列，右眼按脸的中线对称。 */
    eyeColumn: number;
    sideEyeColumn: number;
    /** 嘴最上一行所在的贴图行；正面的嘴左右居中。 */
    mouthRow: number;
    sideMouthColumn: number;
  };
  /** 眼睛和嘴的图案，. 是不改动底图的透明格。 */
  eyes: Record<EyeShape, FacePattern>;
  mouths: Record<MouthShape, FacePattern>;
  /**
   * 手的像素画，画的是画面右边那只手，左手镜像。. 是挖空的格子，手的形状完全由像素画决定；
   * s 肤色、S 肤色暗档。手的 3D 小球只用来定位置和前后遮挡。
   */
  handArt: PixelArt;
  parts: Record<BodyPartName, Part>;
  outfits: { uniform: UniformDesign; lolita: LolitaDesign };
};

/** 脸部贴图里每个字母对应的颜色。 */
export const faceLetters: Record<string, BodyColorName> = {
  H: "hair",
  h: "tailHair",
  ".": "skin",
  k: "lash",
  d: "pupilDark",
  p: "pupil",
  l: "pupilLight",
  w: "highlight",
  b: "blush",
  q: "lip",
  o: "mouth",
};

const still: Vec3 = [0, 0, 0],
  unit: Vec3 = [1, 1, 1];

export const defaultCharacterDesign: CharacterDesign = {
  colors: {
    hair: "#e2b996",
    tailHair: "#cfa27f",
    skin: "#ffe6d5",
    legSkin: "#f6cdb6",
    pearl: "#fffaf3",
    ribbon: "#8cc8ea",
    clip: "#c4e8fb",
    lash: "#45263f",
    pupilDark: "#563076",
    pupil: "#7d4ea8",
    pupilLight: "#c99be2",
    highlight: "#ffffff",
    blush: "#f6aaa6",
    lip: "#e09a90",
    mouth: "#b0606a",
  },
  face: {
    // 正面：第 5 行以上藏在帽子下面，h 是发缕之间的细缝，第 9 行是长短不一的刘海尖，
    // 发尖之间的几道缝露出额头；眼睛以下左右都只留两列鬓发，让出脸宽，两眼才分得开；
    // 下巴两角留皮肤色，脸的下缘是头的圆轮廓，不被头发包住。
    front: [
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHHHHHHHHHHHHH",
      "HHHHHHhHHHHhHhHHHH",
      "HHHHHhHHHhHHhHhHHH",
      "HHHHhHHhHhhHHhHHHH",
      "HHh.Hh.HH.HhH.HhHH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
      "HH..............HH",
    ],
    // 侧面：最后一列朝前，鬓发后面都是头发，脸只露出最前面几列。
    side: [
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
    ],
    eyeRow: 10,
    // 两眼之间隔 6 像素，比眼宽多 3 像素；眼距太近会显得像皱眉。
    eyeColumn: 3,
    sideEyeColumn: 13,
    mouthRow: 15,
    sideMouthColumn: 12,
  },
  // 正面 3×4、侧面 2×4，两只眼睛用同一个图案。不画眼白和高光：最上一行睫毛色，往下两行紫、一行浅紫，
  // 从深到浅的渐变。小五官配大块头发，低分辨率下更精致。
  // 闭眼和开心的线都用睫毛色；害羞是睫毛压下来一行；惊讶是空心的圆圈，同样上深下浅。
  eyes: {
    open: { front: ["kkk", "ppp", "ppp", "lll"], side: ["kk", "pp", "pp", "ll"] },
    closed: { front: ["...", "...", "kkk", "..."], side: ["..", "..", "kk", ".."] },
    happy: { front: ["...", ".k.", "k.k", "..."], side: ["..", "kk", "k.", ".."] },
    shy: { front: ["...", "kkk", "ppp", "lll"], side: ["..", "kk", "pp", "ll"] },
    surprised: { front: ["kkk", "p.p", "p.p", "lll"], side: ["kk", "p.", "p.", "ll"] },
  },
  mouths: {
    line: { front: ["qq"], side: ["q"] },
    smile: { front: ["q..q", ".qq."], side: ["q"] },
    open: { front: ["oo"], side: ["o"] },
  },
  // 正面每只手 4×3：最靠内一列挖空，两只手之间露出 1 像素衣服的颜色；挨着它的一列和底行压暗，
  // 外下角留一格亮色，手看起来是圆的。
  handArt: {
    front: { rows: [".Sss", ".Sss", ".SSs"], origin: [2, 1.5] },
    side: { rows: ["ss", "ss", "SS"], origin: [1, 1.5] },
    back: { rows: [".ss.", "Ssss", ".SS."], origin: [2, 1.5] },
  },
  parts: {
    // 头部整体（头、头发、帽子、马尾）的中心和缩放。
    // 约 1.8 头身：头（含帽子）约占身高的 55%，下巴以下的身体约 16 个像素。
    head: { position: [0, 1.04, 0], size: [1.15, 1.15, 1.15], rotation: still },
    face: { position: still, size: [0.29, 0.27, 0.27], rotation: still },
    // 头发外壳前后比左右略扁，侧面看后脑不往后鼓，整个头接近圆的。
    hairShell: { position: [0, 0.05, -0.09], size: [0.33, 0.31, 0.29], rotation: still },
    nape: { position: [0, -0.14, -0.07], size: [0.3, 0.12, 0.2], rotation: still },
    sideLock: { position: still, size: unit, rotation: still },
    clip: { position: [0.11, 0.17, 0.18], size: unit, rotation: [-29, 30, 0] },
    // 贝雷帽比头小一圈、上下压扁，几乎平扣在头顶，只往后偏一点：侧面看帽檐和眼睛之间露出一截刘海。
    hat: { position: [0, 0.255, -0.06], size: [0.9, 0.555, 0.9], rotation: [-6, 0, 0] },
    // 马尾的系结点：往里收拢 3°，前后在头的中线稍后，尺寸 y 是马尾长度，垂到裙子中段。
    tail: { position: [0.27, 0.2, -0.07], size: [1, 1, 1], rotation: [0, 0, -3] },
    ribbonBow: { position: [0, -0.03, 0], size: unit, rotation: still },
    ribbonStrip: { position: [0.03, 0.045, 0], size: [1, 1.27, 1], rotation: [0, 0, -19] },
    // 手的小球比 4×3 的像素画略大一圈，像素画才完整；位置由动作决定。
    hand: { position: still, size: [0.085, 0.08, 0.04], rotation: still },
    hip: { position: [0.08, 0.23, 0], size: unit, rotation: still },
    leg: { position: [0, -0.11, 0], size: [0.05, 0.11, 0.05], rotation: still },
  },
  outfits: {
    uniform: {
      // 双手在毛衣下摆处并在一起，中间的缝画在手的像素画里；手紧贴衣服，不会被描出深色轮廓。
      restHand: [0.08, 0.38, 0.22],
      colors: {
        sweater: "#ffe2a3",
        rib: "#f2c983",
        collar: "#fffaf3",
        knot: "#8cc8ea",
        skirt: "#9fd1ee",
        skirtBand: "#fffaf3",
        gold: "#e8b65a",
        shoe: "#9c6340",
      },
      parts: {
        skirt: { position: still, size: unit, rotation: still },
        sweater: { position: still, size: unit, rotation: still },
        collar: { position: [0, 0.66, -0.005], size: [0.15, 0.04, 0.125], rotation: still },
        knot: { position: [0, 0.62, 0.17], size: [0.08, 0.05, 0.03], rotation: still },
        collarFlap: { position: [0, 0.623, -0.157], size: [0.24, 0.115, 0.02], rotation: still },
        collarTrim: { position: [0, 0.6, -0.153], size: [0.24, 0.15, 0.012], rotation: still },
        shoe: { position: [0, -0.2075, 0.03], size: [0.11, 0.045, 0.12], rotation: still },
      },
    },
    lolita: {
      // 双手并在裙盘正面，每只 4 像素宽，左右正好相接；手紧贴裙面，不会被描出深色轮廓。
      restHand: [0.08, 0.3, 0.23],
      colors: {
        // 可可棕比头发深一档，和脸、头发的明暗拉得开；水蓝的蝴蝶结和丝带和马尾丝带、发夹同色，
        // 和肤色的手是冷暖对比，分得开。其他配色在预览页的「配色对比」里比较。
        dress: "#6b4a3e",
        accent: "#8cc8ea",
        // 圆翻领和裙摆下露出的衬裙蕾丝边，和帽子同一种奶白。
        trim: "#fffaf3",
        shoe: "#5a3c3a",
      },
      // 领口下一个蝴蝶结：两边的圈、中间压暗的结；两条 1 像素的丝带从结下面垂下来，往两边斜着散开。
      // 领口附近上身只有约 7 像素宽，第一行要收窄，画到上身外面的格子不会显示。
      // 两个圈的外缘和下缘用暗色，蝴蝶结有立体感。
      chestArt: {
        front: {
          rows: [
            ".aA....aA.",
            ".aaaAAaaa.",
            ".Aa.aa.AA.",
            "...a..a...",
            "...a..a...",
            "..a....a..",
            "..a....a..",
            "..........",
          ],
          origin: [5, 4],
        },
        side: {
          rows: [
            "..........",
            "....aa....",
            "....aA....",
            "....a.....",
            "....a.....",
            "...a......",
            "...a......",
            "...a......",
          ],
          origin: [5, 4],
        },
        back: {
          rows: [
            "..........",
            "..........",
            "..........",
            "..........",
            "..........",
            "..........",
            "..........",
            "..........",
          ],
          origin: [5, 4],
        },
      },
      parts: {
        dress: { position: still, size: unit, rotation: still },
        bodice: { position: still, size: unit, rotation: still },
        // 胸前像素画的中心，在上身正面；像素画第一行落在领口下面。
        chest: { position: [0, 0.5, 0.165], size: unit, rotation: still },
        // 圆翻领：脖子一圈，正面是下巴下面一道奶白边。
        collar: { position: [0, 0.68, 0], size: [0.15, 0.035, 0.14], rotation: still },
        // 背后的两片半圆领片，左右镜像，贴在后背上。
        collarFlap: { position: [0.08, 0.6, -0.125], size: [0.082, 0.08, 0.045], rotation: still },
        // 小圆头鞋，相对胯，左右镜像。
        shoe: { position: [0, -0.2, 0.025], size: [0.055, 0.035, 0.07], rotation: still },
      },
    },
  },
};
