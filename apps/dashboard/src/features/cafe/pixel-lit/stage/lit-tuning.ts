/**
 * 光影喫茶店的调光参数：灯光、画面后处理、渲染方式、角色受光。
 * 两个预设是起点，调光面板在预设的基础上实时修改，调满意后把数值写回这里。
 */
export type LightingPresetId = "afternoon" | "dusk";

/** 色调映射：neutral 几乎不改变浅色，角色的奶黄、浅蓝不会发灰；aces 对比更强但会压暗、去饱和。 */
export type ToneMappingName = "neutral" | "aces" | "agx";

/** full：整个画面按屏幕分辨率渲染；pixel：场景和光影按像素网格渲染再放大，泛光和调色仍是全分辨率。 */
export type RenderMode = "full" | "pixel";

export type LitTuning = {
  background: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  windowLightColor: string;
  windowLightIntensity: number;
  windowBackdropColor: string;
  windowBackdropIntensity: number;
  shaftColor: string;
  shaftStrength: number;
  /** 吧台主光、圆桌吊灯和各处暖色补光共用的强度。 */
  pendantIntensity: number;
  coneStrength: number;
  accentColor: string;
  accentIntensity: number;
  /** 阴影边缘的模糊半径，0 是硬边。 */
  shadowSoftness: number;
  /** 空中浮尘的亮度，0 关掉。 */
  dustStrength: number;
  exposure: number;
  toneMapping: ToneMappingName;
  bloomStrength: number;
  bloomRadius: number;
  /** 亮度超过它的像素才发光晕。 */
  bloomThreshold: number;
  saturation: number;
  vignette: number;
  renderMode: RenderMode;
  /** 角色受到场景灯光的整体倍率，1 和家具受光一致。 */
  characterLightStrength: number;
  /** 角色受光的下限，防止在暗处黑成一团。 */
  characterMinLight: number;
  /** 角色受光的上限，防止浅色衣服在灯旁被照得发白、发光晕。 */
  characterMaxLight: number;
  /** 角色明暗分几档：0 平滑过渡，2–4 是分档的卡通明暗。 */
  characterBands: number;
  /** 角色脚下落地阴影的浓度，0 关掉。 */
  characterContactShadow: number;
};

const common = {
  shadowSoftness: 2.4,
  dustStrength: 0.25,
  toneMapping: "neutral",
  bloomStrength: 0.34,
  bloomRadius: 0.56,
  bloomThreshold: 1.2,
  saturation: 1.08,
  vignette: 0.32,
  renderMode: "pixel",
  characterLightStrength: 1,
  characterMinLight: 0.35,
  characterMaxLight: 1.2,
  characterBands: 3,
  characterContactShadow: 0.6,
} as const;

export const LIT_PRESETS: Record<LightingPresetId, LitTuning> = {
  afternoon: {
    ...common,
    background: "#10111a",
    hemiSky: "#52628a",
    hemiGround: "#332219",
    hemiIntensity: 0.42,
    ambientColor: "#2e3348",
    ambientIntensity: 0.28,
    windowLightColor: "#ffcb7d",
    windowLightIntensity: 5.0,
    windowBackdropColor: "#ffe5aa",
    windowBackdropIntensity: 2.15,
    shaftColor: "#ffd48c",
    shaftStrength: 0.2,
    pendantIntensity: 1.65,
    coneStrength: 0.08,
    accentColor: "#9bd0ff",
    accentIntensity: 4.8,
    exposure: 1.06,
  },
  dusk: {
    ...common,
    background: "#0d0d16",
    hemiSky: "#4d619c",
    hemiGround: "#3b2214",
    hemiIntensity: 0.36,
    ambientColor: "#25263d",
    ambientIntensity: 0.24,
    windowLightColor: "#86abff",
    windowLightIntensity: 3.4,
    windowBackdropColor: "#9cbcff",
    windowBackdropIntensity: 2.35,
    shaftColor: "#8ab0ff",
    shaftStrength: 0.18,
    pendantIntensity: 2.35,
    coneStrength: 0.105,
    accentColor: "#ffab57",
    accentIntensity: 3.4,
    exposure: 1.1,
  },
};
