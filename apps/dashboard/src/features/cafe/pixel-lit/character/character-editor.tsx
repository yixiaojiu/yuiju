import { Copy, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import {
  type ArtGrid,
  type CharacterDesign,
  defaultCharacterDesign,
  type EyeShape,
  faceLetters,
  type MouthShape,
  type OutfitName,
  outfitLabels,
  type Part,
  type Vec3,
} from "./character-design";
import { chestPalette } from "./outfits/lolita";
import { FACE_GRID } from "./pixel-character";
import { type GridEdge, PixelGridEditor } from "./pixel-grid-editor";

/** 编辑器的每次修改都基于最新的造型算出新造型，连续拖动画格子时不会丢掉中间的修改。 */
export type DesignChange = (change: (design: CharacterDesign) => CharacterDesign) => void;

const tabs = ["颜色", "像素画", "部件", "姿势"] as const;
type Tab = (typeof tabs)[number];

const bodyColorLabels: Record<string, string> = {
  hair: "头发",
  tailHair: "马尾、发缝",
  skin: "皮肤",
  legSkin: "腿",
  pearl: "白（帽子、发夹）",
  ribbon: "马尾丝带",
  clip: "发夹",
  lash: "睫毛",
  pupilDark: "瞳孔深",
  pupil: "瞳孔",
  pupilLight: "瞳孔亮",
  highlight: "高光",
  blush: "腮红",
  lip: "嘴线",
  mouth: "嘴里",
};
const outfitColorLabels: Record<OutfitName, Record<string, string>> = {
  uniform: {
    sweater: "毛衣",
    rib: "罗纹",
    collar: "领口和领片",
    knot: "领结",
    skirt: "裙子",
    skirtBand: "裙子白边",
    gold: "领片金边",
    shoe: "鞋",
  },
  lolita: {
    dress: "裙子和上身",
    accent: "蝴蝶结、丝带和领片边",
    trim: "翻领和蕾丝边",
    shoe: "鞋",
  },
};

/**
 * 编辑器按名字读写颜色和部件：身体一张表，当前这套衣服一张表。
 * 各套衣服的字段不同，这里统一当成按名字索引的表来读写。
 */
type Scope = "body" | "outfit";
type Table = { colors: Record<string, string>; parts: Record<string, Part> };
function tableOf(design: CharacterDesign, scope: Scope, outfit: OutfitName): Table {
  return scope === "body" ? design : design.outfits[outfit];
}
function withTable(
  design: CharacterDesign,
  scope: Scope,
  outfit: OutfitName,
  table: Table,
): CharacterDesign {
  if (scope === "body") {
    return { ...design, colors: table.colors, parts: table.parts } as CharacterDesign;
  }
  return { ...design, outfits: { ...design.outfits, [outfit]: table } } as CharacterDesign;
}

const brushLabels: Record<string, string> = {
  H: "头发",
  h: "发缝",
  ".": "皮肤 / 透明",
  k: "睫毛",
  d: "瞳孔深",
  p: "瞳孔",
  l: "瞳孔亮",
  w: "高光",
  b: "腮红",
  q: "嘴线",
  o: "嘴里",
};

type View = "front" | "side";
type ArtView = View | "back";
/** 像素画分页可以画的图：脸的底图、眼睛和嘴的图案、手、洛丽塔的胸前图案。 */
type ArtTarget =
  | { kind: "face"; view: View }
  | { kind: "eyes"; shape: EyeShape; view: View }
  | { kind: "mouths"; shape: MouthShape; view: View }
  | { kind: "hand"; view: ArtView }
  | { kind: "chest"; view: ArtView };
const viewLabels: Record<ArtView, string> = { front: "正面", side: "侧面", back: "背面" };
const eyeLabels: Record<EyeShape, string> = {
  open: "睁眼",
  closed: "闭眼",
  happy: "开心",
  shy: "害羞",
  surprised: "惊讶",
  droop: "下垂",
  sharp: "上挑",
  sleepy: "半睁",
  narrow: "细眼",
};
const mouthLabels: Record<MouthShape, string> = {
  line: "平嘴",
  smile: "微笑",
  open: "张嘴",
  laugh: "大笑",
  frown: "撇嘴",
};
const views: View[] = ["front", "side"];
const artViews: ArtView[] = ["front", "side", "back"];
const artTargets: { group: string; label: string; target: ArtTarget }[] = [
  ...views.map((view) => ({
    group: "脸",
    label: `${viewLabels[view]}底图`,
    target: { kind: "face", view } as const,
  })),
  ...(Object.keys(eyeLabels) as EyeShape[]).flatMap((shape) =>
    views.map((view) => ({
      group: "眼睛",
      label: `${eyeLabels[shape]} · ${viewLabels[view]}`,
      target: { kind: "eyes", shape, view } as const,
    })),
  ),
  ...(Object.keys(mouthLabels) as MouthShape[]).flatMap((shape) =>
    views.map((view) => ({
      group: "嘴",
      label: `${mouthLabels[shape]} · ${viewLabels[view]}`,
      target: { kind: "mouths", shape, view } as const,
    })),
  ),
  ...artViews.map((view) => ({
    group: "手",
    label: `手 · ${viewLabels[view]}`,
    target: { kind: "hand", view } as const,
  })),
  ...artViews.map((view) => ({
    group: "洛丽塔",
    label: `胸前图案 · ${viewLabels[view]}`,
    target: { kind: "chest", view } as const,
  })),
];
const artGroups = ["脸", "眼睛", "嘴", "手", "洛丽塔"];

function rowsOf(design: CharacterDesign, target: ArtTarget) {
  if (target.kind === "face") {
    return design.face[target.view];
  }
  if (target.kind === "eyes") {
    return design.eyes[target.shape][target.view];
  }
  if (target.kind === "mouths") {
    return design.mouths[target.shape][target.view];
  }
  return artGridOf(design, target).rows;
}

function withRows(design: CharacterDesign, target: ArtTarget, rows: string[]): CharacterDesign {
  if (target.kind === "face") {
    return { ...design, face: { ...design.face, [target.view]: rows } };
  }
  if (target.kind === "eyes") {
    const eye = { ...design.eyes[target.shape], [target.view]: rows };
    return { ...design, eyes: { ...design.eyes, [target.shape]: eye } };
  }
  if (target.kind === "mouths") {
    const mouth = { ...design.mouths[target.shape], [target.view]: rows };
    return { ...design, mouths: { ...design.mouths, [target.shape]: mouth } };
  }
  return withArtGrid(design, target, { ...artGridOf(design, target), rows });
}

/** 投影像素画（手、胸前图案）某个朝向的画布，带着锚点在画布上的位置。 */
type ArtGridTarget = Extract<ArtTarget, { kind: "hand" | "chest" }>;
function artGridOf(design: CharacterDesign, target: ArtGridTarget): ArtGrid {
  return target.kind === "hand"
    ? design.handArt[target.view]
    : design.outfits.lolita.chestArt[target.view];
}
function withArtGrid(
  design: CharacterDesign,
  target: ArtGridTarget,
  grid: ArtGrid,
): CharacterDesign {
  if (target.kind === "hand") {
    return { ...design, handArt: { ...design.handArt, [target.view]: grid } };
  }
  const { lolita } = design.outfits;
  return {
    ...design,
    outfits: {
      ...design.outfits,
      lolita: { ...lolita, chestArt: { ...lolita.chestArt, [target.view]: grid } },
    },
  };
}

/** 画布最多扩到多少格，再大就超出角色了。 */
const MAX_ART_SIZE = 32;

/** 在画布的一边加（delta 为 1，补透明格）或删（delta 为 -1）一行或一列。 */
function resizeRows(rows: string[], edge: GridEdge, delta: 1 | -1) {
  const width = rows[0].length;
  if (edge === "top") {
    return delta > 0 ? [".".repeat(width), ...rows] : rows.slice(1);
  }
  if (edge === "bottom") {
    return delta > 0 ? [...rows, ".".repeat(width)] : rows.slice(0, -1);
  }
  if (edge === "left") {
    return rows.map((line) => (delta > 0 ? `.${line}` : line.slice(1)));
  }
  return rows.map((line) => (delta > 0 ? `${line}.` : line.slice(0, -1)));
}

/**
 * 扩展画布后的造型。手和胸前图案往左、往上扩展时，锚点在画布上的位置跟着挪，画好的内容在角色身上不动；
 * 眼睛和嘴的图案按左上角摆在脸上，往左、往上扩展时内容会跟着往右、往下挪一格，位置用下面的滑杆调回来。
 */
function resizeArt(
  design: CharacterDesign,
  target: ArtTarget,
  edge: GridEdge,
  delta: 1 | -1,
): CharacterDesign {
  if (target.kind === "hand" || target.kind === "chest") {
    const grid = artGridOf(design, target);
    const [x, y] = grid.origin;
    const origin: [number, number] =
      edge === "left" ? [x + delta, y] : edge === "top" ? [x, y + delta] : [x, y];
    return withArtGrid(design, target, { rows: resizeRows(grid.rows, edge, delta), origin });
  }
  return withRows(design, target, resizeRows([...rowsOf(design, target)], edge, delta));
}

/**
 * 眼睛、嘴的图案和它们的摆放是否都落在 18×18 的脸部贴图里（所有表情一起检查，它们共用同一套摆放）：
 * 腮红画在眼睛下面紧挨的一行、外眼角外侧一格，最多 3 格；两只眼睛左右对称，不能重叠。
 */
function faceLayoutFits(design: CharacterDesign) {
  const { eyeRow, eyeColumn, sideEyeColumn, mouthRow, sideMouthColumn } = design.face;
  const eyesFit = Object.values(design.eyes).every(
    ({ front, side }) =>
      eyeRow >= 0 &&
      eyeRow + front.length < FACE_GRID &&
      eyeRow + side.length < FACE_GRID &&
      eyeColumn >= 1 &&
      2 * (eyeColumn + front[0].length) <= FACE_GRID &&
      sideEyeColumn >= 1 &&
      sideEyeColumn + 1 < FACE_GRID &&
      sideEyeColumn + side[0].length <= FACE_GRID,
  );
  const mouthsFit = Object.values(design.mouths).every(
    ({ front, side }) =>
      mouthRow >= 0 &&
      mouthRow + Math.max(front.length, side.length) <= FACE_GRID &&
      front[0].length <= FACE_GRID &&
      sideMouthColumn >= 0 &&
      sideMouthColumn + side[0].length <= FACE_GRID,
  );
  return eyesFit && mouthsFit;
}

/** 这张图能不能在这一边加减一行（列）：至少留 1 格，最多 MAX_ART_SIZE 格；眼睛和嘴扩展后还要放得进脸里。 */
function canResize(design: CharacterDesign, target: ArtTarget, edge: GridEdge, delta: 1 | -1) {
  const rows = rowsOf(design, target);
  const length = edge === "top" || edge === "bottom" ? rows.length : rows[0].length;
  if (length + delta < 1 || length + delta > MAX_ART_SIZE) {
    return false;
  }
  return target.kind === "hand" || target.kind === "chest"
    ? true
    : faceLayoutFits(resizeArt(design, target, edge, delta));
}

/** 每张图能用的笔刷：字母、名字和颜色。. 在脸的底图里是皮肤，在其他图里是透明格。 */
function brushesOf(design: CharacterDesign, target: ArtTarget) {
  if (target.kind === "hand") {
    return [
      { letter: "s", label: "肤色", color: design.colors.skin },
      { letter: "S", label: "肤色暗", color: design.colors.legSkin },
      { letter: ".", label: "挖空", color: "transparent" },
    ];
  }
  if (target.kind === "chest") {
    const palette = chestPalette(design.outfits.lolita.colors.accent);
    return [
      { letter: "a", label: "点缀色", color: palette.a },
      { letter: "A", label: "点缀色暗", color: palette.A },
      { letter: ".", label: "透明", color: "transparent" },
    ];
  }
  return Object.entries(faceLetters).map(([letter, name]) => ({
    letter,
    label: brushLabels[letter],
    color: design.colors[name],
  }));
}

/** 每张图下面的说明。 */
const artNotes: Record<ArtTarget["kind"], string> = {
  face: "脸的底图里「皮肤 / 透明」就是皮肤。底图固定 18×18，已经盖住整个头。在左边切换朝向查看效果。",
  eyes: "眼睛图案里「皮肤 / 透明」是透明格，不改动底图。图案按左上角摆在脸上，往左、往上扩展时内容会往右、往下挪一格，用下面的滑杆调回来；扩出脸外的 + 不能点。在左边切换表情和朝向查看效果。",
  mouths:
    "嘴的图案里「皮肤 / 透明」是透明格，不改动底图，正面的嘴左右居中。往上扩展时内容会往下挪一格，用下面的滑杆调回来。在左边切换表情和朝向查看效果。",
  hand: "画的是画面右边那只手，左手自动镜像；挖空的格子不显示，手的形状完全由这张图决定。四周的 + / − 扩展画布，画好的内容在身上不动。",
  chest:
    "洛丽塔上身的胸前图案，透明格露出裙子的颜色；画到上身外面的格子不显示。四周的 + / − 扩展画布，画好的内容在身上不动；整体位置在「部件」页的「胸前图案中心」调。",
};

/** 脸部贴图里眼睛、嘴的摆放。每个滑杆能拖到的范围按眼睛和嘴的图案大小算，保证都落在脸部贴图里。 */
const faceLayoutSliders: {
  key: "eyeRow" | "eyeColumn" | "sideEyeColumn" | "mouthRow" | "sideMouthColumn";
  label: string;
}[] = [
  { key: "eyeRow", label: "眼睛所在行" },
  { key: "eyeColumn", label: "正面左眼列" },
  { key: "sideEyeColumn", label: "侧面眼睛列" },
  { key: "mouthRow", label: "嘴所在行" },
  { key: "sideMouthColumn", label: "侧面嘴列" },
];
/** 一个摆放滑杆在当前图案大小下能取的最小值和最大值。 */
function layoutRange(design: CharacterDesign, key: (typeof faceLayoutSliders)[number]["key"]) {
  const allowed = Array.from({ length: FACE_GRID }, (_, value) => value).filter((value) =>
    faceLayoutFits({ ...design, face: { ...design.face, [key]: value } }),
  );
  return { min: allowed[0], max: allowed[allowed.length - 1] };
}

type PartField = keyof Part;
const allFields: PartField[] = ["position", "size", "rotation"];
type PartInfo = { key: string; label: string; fields: PartField[]; size: string; note?: string };
/** 部件分页的清单。fields 是这个部件用得到的几项，size 是尺寸那一项在这个部件上的含义。 */
const bodyPartGroups: { title: string; parts: PartInfo[] }[] = [
  {
    title: "头",
    parts: [
      {
        key: "head",
        label: "头部整体",
        fields: allFields,
        size: "缩放",
        note: "头、头发、帽子、马尾一起移动和缩放。",
      },
      { key: "face", label: "脸（头部椭球）", fields: ["position", "size"], size: "半径" },
      { key: "hairShell", label: "头发外壳", fields: allFields, size: "半径" },
      { key: "nape", label: "后脑短发", fields: allFields, size: "半径" },
      { key: "sideLock", label: "鬓发", fields: allFields, size: "缩放", note: "左右镜像。" },
      { key: "clip", label: "发夹", fields: allFields, size: "缩放" },
      { key: "hat", label: "贝雷帽", fields: allFields, size: "缩放" },
    ],
  },
  {
    title: "马尾",
    parts: [
      {
        key: "tail",
        label: "马尾",
        fields: allFields,
        size: "缩放（y 是长度）",
        note: "位置是系结点，旋转 z 是往里收拢的角度。左右镜像。",
      },
      { key: "ribbonBow", label: "丝带结", fields: allFields, size: "缩放", note: "左右镜像。" },
      {
        key: "ribbonStrip",
        label: "丝带垂条",
        fields: allFields,
        size: "缩放",
        note: "左右镜像。",
      },
    ],
  },
  {
    title: "手脚",
    parts: [
      {
        key: "hand",
        label: "手",
        fields: ["size"],
        size: "半径",
        note: "手是一个小球，位置由动作决定，待机位置在「姿势」分页。",
      },
      {
        key: "hip",
        label: "胯（腿的转轴）",
        fields: ["position"],
        size: "",
        note: "左右镜像，平时藏在裙子里。",
      },
      { key: "leg", label: "腿", fields: allFields, size: "半径", note: "相对胯。" },
    ],
  },
];
const outfitParts: Record<OutfitName, PartInfo[]> = {
  uniform: [
    { key: "skirt", label: "裙子（含白边）", fields: allFields, size: "缩放" },
    { key: "sweater", label: "毛衣（含罗纹）", fields: allFields, size: "缩放" },
    { key: "collar", label: "领口", fields: allFields, size: "半径" },
    { key: "knot", label: "领结", fields: allFields, size: "长宽高" },
    { key: "collarFlap", label: "背后领片", fields: allFields, size: "长宽高" },
    { key: "collarTrim", label: "领片金边", fields: allFields, size: "长宽高" },
    { key: "shoe", label: "鞋", fields: allFields, size: "长宽高", note: "相对胯，左右镜像。" },
  ],
  lolita: [
    {
      key: "dress",
      label: "蓬蓬裙",
      fields: allFields,
      size: "缩放",
      note: "裙子上的竖褶是建模时加的，换主色时褶皱阴影跟着变。",
    },
    { key: "bodice", label: "上身", fields: allFields, size: "缩放" },
    {
      key: "chest",
      label: "胸前图案中心",
      fields: ["position"],
      size: "",
      note: "胸前像素画的中心（上身空间），图案本身在「像素画」页画。",
    },
    { key: "collar", label: "领口", fields: allFields, size: "半径" },
    { key: "collarFlap", label: "背后领片", fields: allFields, size: "长宽高" },
    { key: "collarTrim", label: "领片水蓝边", fields: allFields, size: "长宽高" },
    { key: "shoe", label: "鞋", fields: allFields, size: "半径", note: "相对胯，左右镜像。" },
  ],
};
const fieldLabels: Record<PartField, string> = {
  position: "位置",
  size: "尺寸",
  rotation: "旋转（度）",
};

/** 去掉滑杆和输入框带来的浮点尾数，复制出来的 JSON 干净。 */
function tidy(value: number) {
  return Math.round(value * 10000) / 10000;
}

/**
 * 一组 x、y、z 数值：滑杆在默认值附近粗调，输入框精确输入（可以超出滑杆范围）。
 * initial 是代码里的默认值，滑杆范围围绕它，编辑过程中范围不会跟着漂移。
 */
function VectorField({
  label,
  value,
  initial,
  kind,
  onChange,
}: {
  label: string;
  value: Vec3;
  initial: Vec3;
  kind: PartField;
  onChange: (value: Vec3) => void;
}) {
  const step = kind === "rotation" ? 1 : 0.005;
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-xs text-[#786c60]">{label}</legend>
      {(["x", "y", "z"] as const).map((axis, index) => {
        const base = initial[index];
        const [min, max] =
          kind === "position"
            ? [base - 0.3, base + 0.3]
            : kind === "rotation"
              ? [base - 45, base + 45]
              : [0, Math.max(base * 2, base + 0.1)];
        const set = (next: number) => {
          const updated: [number, number, number] = [...value];
          updated[index] = tidy(next);
          onChange(updated);
        };
        return (
          <div key={axis} className="grid grid-cols-[1rem_1fr_4.5rem] items-center gap-2">
            <span className="font-mono text-xs text-[#786c60]">{axis}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[index]}
              className="h-4 w-full cursor-pointer accent-[#876950]"
              onChange={(event) => set(event.target.valueAsNumber)}
            />
            <input
              type="number"
              step={step}
              value={value[index]}
              className="rounded border border-[#d6cebf] bg-white px-1 py-0.5 text-right font-mono text-xs tabular-nums"
              onChange={(event) => {
                // 输入框清空或只输入了负号时还不是数字，等输入完整再更新。
                if (!Number.isNaN(event.target.valueAsNumber)) {
                  set(event.target.valueAsNumber);
                }
              }}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * 草稿和代码里默认造型不同的部分，层级结构不变，没有不同时为 undefined。
 * 对象逐个字段往下比；数组（像素画的一张图、位置、尺寸）只要有一处不同就整个保留，写回时看得到全貌。
 */
function changesFrom(draft: unknown, base: unknown): unknown {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (isObject(draft) && isObject(base)) {
    const changed = Object.entries(draft)
      .map(([key, value]) => [key, changesFrom(value, base[key])] as const)
      .filter(([, value]) => value !== undefined);
    return changed.length > 0 ? Object.fromEntries(changed) : undefined;
  }
  return JSON.stringify(draft) === JSON.stringify(base) ? undefined : draft;
}

/**
 * 像素店员的造型编辑面板：颜色、脸部像素、部件摆放、待机手位。
 * 改动实时作用到预览里的角色；调满意后点「复制改动」，只复制和代码默认值不同的部分，发给开发者写回 character-design.ts。
 */
export function CharacterEditor({
  design,
  outfit,
  onChange,
  onOutfitChange,
  onReset,
}: {
  design: CharacterDesign;
  outfit: OutfitName;
  onChange: DesignChange;
  onOutfitChange: (outfit: OutfitName) => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<Tab>("颜色");
  const [artTarget, setArtTarget] = useState(0);
  const [brush, setBrush] = useState("H");
  // 选中的部件写成「范围:名字」，比如 body:head、outfit:skirt。
  const [partId, setPartId] = useState("body:head");
  const [copied, setCopied] = useState(false);
  const changes = changesFrom(design, defaultCharacterDesign);
  const edited = changes !== undefined;

  const { target } = artTargets[artTarget];
  const brushes = brushesOf(design, target);
  const [partScope, partKey] = partId.split(":") as [Scope, string];
  const partInfo = (
    partScope === "body" ? bodyPartGroups.flatMap((group) => group.parts) : outfitParts[outfit]
  ).find(({ key }) => key === partKey)!;
  const colorSections: [Scope, string, Record<string, string>][] = [
    ["body", "身体", bodyColorLabels],
    ["outfit", outfitLabels[outfit], outfitColorLabels[outfit]],
  ];

  return (
    <section className="grid content-start gap-4 rounded-2xl border border-[#d6cebf] bg-[#fcf9f2] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <SlidersHorizontal size={17} />
          造型
          <span className="text-xs font-normal text-[#94877a]">
            {edited ? "草稿未写回" : "与代码一致"}
          </span>
        </h2>
        <div className="flex gap-3 text-xs text-[#78685b]">
          <button
            type="button"
            disabled={!edited}
            className="flex items-center gap-1 hover:text-[#44342d] disabled:opacity-40 disabled:hover:text-[#78685b]"
            onClick={async () => {
              await navigator.clipboard.writeText(JSON.stringify(changes, null, 2));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy size={13} />
            {copied ? "已复制" : edited ? "复制改动" : "无改动"}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-[#44342d]"
            onClick={() => {
              if (window.confirm("放弃草稿，回到代码里的默认造型？")) {
                onReset();
              }
            }}
          >
            <RotateCcw size={13} />
            重置
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-[#786c60]">衣服</span>
        {(Object.keys(outfitLabels) as OutfitName[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={outfit === name}
            className={`rounded-md px-2.5 py-1 ${outfit === name ? "bg-[#51453f] text-[#fff9ee]" : "text-[#645a4e] hover:bg-[#e9e1d4]"}`}
            onClick={() => {
              onOutfitChange(name);
              // 两套衣服的部件不同，换衣服时部件分页回到身体的第一个部件。
              if (partScope === "outfit") {
                setPartId("body:head");
              }
            }}
          >
            {outfitLabels[name]}
          </button>
        ))}
      </div>

      <div className="flex gap-1 rounded-lg bg-[#efe8dc] p-1 text-sm">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            className={`flex-1 rounded-md py-1 ${tab === name ? "bg-[#51453f] text-[#fff9ee]" : "text-[#645a4e] hover:bg-[#e2d9ca]"}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "颜色" &&
        colorSections.map(([scope, title, labels]) => (
          <div key={scope} className="grid gap-2 text-sm">
            <h3 className="text-xs text-[#786c60]">{title}</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {Object.entries(labels).map(([name, label]) => (
                <label key={name} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={tableOf(design, scope, outfit).colors[name]}
                    className="h-6 w-7 shrink-0 cursor-pointer rounded border border-[#cfc6b8] bg-transparent"
                    onChange={(event) => {
                      const color = event.target.value;
                      onChange((current) => {
                        const table = tableOf(current, scope, outfit);
                        return withTable(current, scope, outfit, {
                          ...table,
                          colors: { ...table.colors, [name]: color },
                        });
                      });
                    }}
                  />
                  <span className="text-xs">{label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

      {tab === "像素画" && (
        <div className="grid gap-3 text-sm">
          <select
            value={artTarget}
            className="rounded-md border border-[#d6cebf] bg-white px-2 py-1"
            onChange={(event) => {
              const index = Number(event.target.value);
              setArtTarget(index);
              // 不同的图字母不同，换图时笔刷回到这张图的第一种颜色。
              setBrush(brushesOf(design, artTargets[index].target)[0].letter);
            }}
          >
            {artGroups.map((group) => (
              <optgroup key={group} label={group}>
                {artTargets.map((item, index) =>
                  item.group === group ? (
                    <option key={item.label} value={index}>
                      {item.label}
                    </option>
                  ) : null,
                )}
              </optgroup>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {brushes.map(({ letter, label, color }) => (
              <button
                key={letter}
                type="button"
                aria-pressed={brush === letter}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${brush === letter ? "border-[#51453f] bg-[#efe8dc]" : "border-transparent hover:bg-[#efe8dc]"}`}
                onClick={() => setBrush(letter)}
              >
                <span
                  className="size-3 rounded-sm border border-black/10"
                  style={{ background: color }}
                />
                {label}
              </button>
            ))}
          </div>
          <PixelGridEditor
            rows={rowsOf(design, target)}
            colorOf={(letter) => brushes.find((item) => item.letter === letter)!.color}
            transparent={target.kind !== "face"}
            resize={
              target.kind === "face"
                ? null
                : {
                    can: (edge, delta) => canResize(design, target, edge, delta),
                    apply: (edge, delta) =>
                      onChange((current) => resizeArt(current, target, edge, delta)),
                  }
            }
            onPaint={(row, column) =>
              onChange((current) => {
                const rows = rowsOf(current, target);
                if (rows[row][column] === brush) {
                  return current;
                }
                const line = rows[row];
                const next = rows.map((text, index) =>
                  index === row ? line.slice(0, column) + brush + line.slice(column + 1) : text,
                );
                return withRows(current, target, next);
              })
            }
          />
          <p className="text-xs text-[#94877a]">{artNotes[target.kind]}</p>
          {(target.kind === "face" || target.kind === "eyes" || target.kind === "mouths") && (
            <div className="grid gap-2 border-t border-[#e4dccf] pt-3">
              {faceLayoutSliders.map(({ key, label }) => (
                <label key={key} className="grid grid-cols-[5.5rem_1fr_1.5rem] items-center gap-2">
                  <span className="text-xs">{label}</span>
                  <input
                    type="range"
                    min={layoutRange(design, key).min}
                    max={layoutRange(design, key).max}
                    value={design.face[key]}
                    className="h-4 w-full cursor-pointer accent-[#876950]"
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      onChange((current) => ({
                        ...current,
                        face: { ...current.face, [key]: value },
                      }));
                    }}
                  />
                  <output className="text-right font-mono text-xs tabular-nums text-[#786c60]">
                    {design.face[key]}
                  </output>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "部件" && (
        <div className="grid gap-3 text-sm">
          <select
            value={partId}
            className="rounded-md border border-[#d6cebf] bg-white px-2 py-1"
            onChange={(event) => setPartId(event.target.value)}
          >
            {bodyPartGroups.map((group) => (
              <optgroup key={group.title} label={`身体 · ${group.title}`}>
                {group.parts.map(({ key, label }) => (
                  <option key={key} value={`body:${key}`}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label={outfitLabels[outfit]}>
              {outfitParts[outfit].map(({ key, label }) => (
                <option key={key} value={`outfit:${key}`}>
                  {label}
                </option>
              ))}
            </optgroup>
          </select>
          {partInfo.note && <p className="text-xs text-[#94877a]">{partInfo.note}</p>}
          {partInfo.fields.map((field) => (
            <VectorField
              key={`${partId}-${field}`}
              label={
                field === "size" ? `${fieldLabels.size}：${partInfo.size}` : fieldLabels[field]
              }
              value={tableOf(design, partScope, outfit).parts[partKey][field]}
              initial={tableOf(defaultCharacterDesign, partScope, outfit).parts[partKey][field]}
              kind={field}
              onChange={(value) =>
                onChange((current) => {
                  const table = tableOf(current, partScope, outfit);
                  return withTable(current, partScope, outfit, {
                    ...table,
                    parts: {
                      ...table.parts,
                      [partKey]: { ...table.parts[partKey], [field]: value },
                    },
                  });
                })
              }
            />
          ))}
          <p className="text-xs text-[#94877a]">
            位置相对上一级（头上的部件相对头部中心，身体的部件以脚底为原点），+X 是画面右边，+Z
            朝前。左右对称的部件填画面右边那一个。
          </p>
        </div>
      )}

      {tab === "姿势" && (
        <div className="grid gap-3 text-sm">
          <VectorField
            label={`待机手位（${outfitLabels[outfit]}）`}
            value={design.outfits[outfit].restHand}
            initial={defaultCharacterDesign.outfits[outfit].restHand}
            kind="position"
            onChange={(value) =>
              onChange((current) => ({
                ...current,
                outfits: {
                  ...current.outfits,
                  [outfit]: { ...current.outfits[outfit], restHand: value },
                },
              }))
            }
          />
          <p className="text-xs text-[#94877a]">
            当前这套衣服站着时画面右边那只手的位置，另一只镜像；两套裙子形状不同，各自一份。挥手、说话、上饮品等动作都从这里出发，做完回到这里。
          </p>
        </div>
      )}
    </section>
  );
}
