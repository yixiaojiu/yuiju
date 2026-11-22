import type { UniformDesign } from "../character-design";
import type { OutfitBuild, OutfitKit } from "../pixel-character";

/** 制服：黄色毛衣、白色水手领、蓝色长裙、棕色乐福鞋。 */
export function buildUniform(kit: OutfitKit, { colors, parts }: UniformDesign): OutfitBuild {
  const { attach, oval, block, place, sculpt } = kit;

  // 裙子只有五六行高，褶子画不出来，做成干净的 A 字裙，靠裙摆上方的白边认出是制服裙。
  // 裙子长到鞋面上方：30° 俯视时裙摆前缘正好挡住整条腿，站着只露出两只鞋，走路时鞋在裙摆下前后交替。
  const skirt = place(attach(kit.skirt), parts.skirt);
  sculpt(skirt, colors.skirt, [
    [0.13, 0, 0, 0.3, 0.23],
    [0.245, 0, 0, 0.26, 0.205],
    [0.353, 0, 0, 0.22, 0.18],
    [0.41, 0, 0, 0.2, 0.165],
  ]);
  // 白边离裙摆一个像素，下面只留一行蓝色。
  sculpt(skirt, colors.skirtBand, [
    [0.158, 0, 0, 0.295, 0.229],
    [0.191, 0, 0, 0.284, 0.221],
  ]);

  const sweater = place(attach(kit.upper), parts.sweater);
  // 上身宽约头宽的七成，放进场景不显得头大身子细。
  // 溜肩：从胸口往脖子一路收窄，肩比腰和裙子都窄，少女的肩不宽。
  sculpt(sweater, colors.sweater, [
    [0.353, 0, 0, 0.25, 0.2],
    [0.396, 0, 0, 0.245, 0.195],
    [0.49, 0, 0, 0.225, 0.178],
    [0.56, 0, 0, 0.205, 0.165],
    [0.62, 0, 0, 0.17, 0.145],
    [0.67, 0, 0, 0.12, 0.105],
    [0.72, 0, 0, 0.06, 0.05],
  ]);
  // 毛衣下摆的罗纹。
  sculpt(sweater, colors.rib, [
    [0.349, 0, 0, 0.258, 0.208],
    [0.378, 0, 0, 0.254, 0.204],
  ]);

  // 上衣正面只有大块黄色、领口一道白、胸口一个 2 像素的蓝领结；V 领、开襟、纽扣、口袋都舍掉。
  // 水手领：披在肩上的一圈白领，正面看是下巴下面的一道白边；背后垂下方形领片，
  // 金色方块比领片低出一个像素，露出来就是领片下沿的金边。领子用柔和明暗，正面不会出现一排灰点。
  const collar = attach(kit.upper);
  oval(collar, colors.collar, parts.collar, "soft");
  block(collar, colors.knot, parts.knot);
  block(collar, colors.gold, parts.collarTrim);
  block(collar, colors.collar, parts.collarFlap);

  // 矮矮的长方形棕色乐福鞋。
  for (const [index, side] of [-1, 1].entries()) {
    block(attach(kit.legs[index]), colors.shoe, parts.shoe, side);
  }

  // 裙子只到鞋面上方，腿和鞋在走路时露出来。
  return { showLegs: true };
}
