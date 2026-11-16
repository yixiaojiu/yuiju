import { AVATAR_PRESETS, defaultAvatarConfig } from "./scene/avatar";
import type { AvatarConfig } from "./session/state";

/** 玩家的个人设定。 */
export type PlayerSettings = {
  /** 拖动转视角的灵敏度倍率，1 为默认。 */
  mouseSensitivity: number;
  /** standard 关掉泛光并降低渲染分辨率，给配置较低的电脑用；high 是完整效果。 */
  quality: "standard" | "high";
  /** 进店后是否显示操作提示。 */
  showControlsHint: boolean;
};

/** 保存在浏览器里的玩家档案：捏人配置、头像缩略图和个人设定。 */
export type PlayerProfile = {
  avatar: AvatarConfig;
  /** 捏人确认时截下的头像，data URL；还没捏过人时为 null。 */
  thumbnail: string | null;
  settings: PlayerSettings;
};

const STORAGE_KEY = "yuiju.cafe.profile";

/** 读取玩家档案。第一次来时浏览器里还没有档案，返回一份新档案。 */
export function loadProfile(): PlayerProfile {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }
  return {
    avatar: defaultAvatarConfig(AVATAR_PRESETS[0], ""),
    thumbnail: null,
    settings: { mouseSensitivity: 1, quality: "high", showControlsHint: true },
  };
}

export function saveProfile(profile: PlayerProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
