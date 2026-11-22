import { Color } from "three";
import type { LolitaDesign } from "../character-design";
import type { OutfitBuild, OutfitKit } from "../pixel-character";

/** 胸前像素画里 A（蝴蝶结的结、丝带的暗面）用的暗色：点缀色乘上这个系数。 */
const ACCENT_SHADE = 0.72;

/** 胸前像素画的调色：a 点缀色，A 点缀色压暗一档。编辑器画胸前图案时用同一份。 */
export function chestPalette(accent: string): Record<string, string> {
  return {
    a: accent,
    A: `#${new Color(accent).multiplyScalar(ACCENT_SHADE).getHexString()}`,
  };
}

/**
 * 洛丽塔：参考的是「大头 + 窄腰 + 宽裙盘」的剪影。
 * 主色比头发深一档，脸和手是全身最亮的；上身是一根窄直筒，腰下立刻张开成蓬蓬裙，
 * 下摆和头差不多宽，30° 俯视看是一个宽扁的裙盘，盖住脚。
 * 胸前的蝴蝶结和丝带是一张贴在上身的像素画，1 像素的丝带、弯折都能直接画出来，在编辑器的「像素画」里改；
 * 点缀色要和肤色拉得开，否则和放在裙盘前的手混成一片。
 * 裙子上有 10 道很浅的竖褶，受光后主色自然分出亮面和暗面。
 * 奶白的圆翻领和裙摆下露出的衬裙蕾丝边，和帽子同色，全身是深棕、奶白、水蓝三色。
 */
export function buildLolita(
  kit: OutfitKit,
  { colors, chestArt, parts }: LolitaDesign,
): OutfitBuild {
  const { attach, oval, block, place, sculpt, decal } = kit;

  // 蓬蓬裙：扁扁的一层，腰下立刻往外张开，最宽处在裙摆附近、和头差不多宽；
  // 30° 俯视时裙摆前沿挡住脚，走路时偶尔露出鞋。
  const dress = place(attach(kit.skirt), parts.dress);
  sculpt(
    dress,
    colors.dress,
    [
      [0.08, 0, 0, 0.35, 0.285],
      [0.11, 0, 0, 0.37, 0.3],
      [0.16, 0, 0, 0.37, 0.3],
      [0.22, 0, 0, 0.33, 0.268],
      [0.28, 0, 0, 0.27, 0.22],
      [0.33, 0, 0, 0.215, 0.178],
      [0.37, 0, 0, 0.198, 0.163],
    ],
    undefined,
    { count: 10, depth: 0.035 },
  );
  // 衬裙的蕾丝边：裙子里面一圈奶白，比裙摆低一个像素、略宽，从裙摆下面露出来；
  // 褶比裙子密一倍，下沿起伏成一圈小波浪。
  sculpt(
    dress,
    colors.trim,
    [
      [0.04, 0, 0, 0.36, 0.295],
      [0.07, 0, 0, 0.365, 0.3],
      [0.1, 0, 0, 0.34, 0.28],
    ],
    undefined,
    { count: 20, depth: 0.04 },
  );

  // 上身：一根窄直筒，从腰到胸口几乎等宽，只在肩头往脖子收；往下伸进裙子里。
  const bodice = place(attach(kit.upper), parts.bodice);
  const bodiceMesh = sculpt(bodice, colors.dress, [
    [0.3, 0, 0, 0.2, 0.165],
    [0.375, 0, 0, 0.2, 0.165],
    [0.44, 0, 0, 0.195, 0.16],
    [0.52, 0, 0, 0.19, 0.155],
    [0.6, 0, 0, 0.18, 0.15],
    [0.65, 0, 0, 0.155, 0.135],
    [0.69, 0, 0, 0.115, 0.1],
    [0.72, 0, 0, 0.06, 0.05],
  ]);
  // 胸前的蝴蝶结和丝带画在上身上。
  decal(bodiceMesh, colors.dress, chestArt, chestPalette(colors.accent), parts.chest.position);

  // 奶白水手领，做法和制服一样：脖子一圈领边，正面是下巴下面一道奶白，把头和衣服隔开；
  // 背后垂下方形领片，水蓝方块比领片低出一个像素，露出来就是领片下沿的水蓝边。
  const collar = attach(kit.upper);
  oval(collar, colors.trim, parts.collar, "soft");
  block(collar, colors.accent, parts.collarTrim);
  block(collar, colors.trim, parts.collarFlap);

  // 小圆头鞋。
  for (const [index, side] of [-1, 1].entries()) {
    oval(attach(kit.legs[index]), colors.shoe, parts.shoe, undefined, side);
  }

  return { showLegs: true };
}
