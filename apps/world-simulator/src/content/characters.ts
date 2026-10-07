import { createIdleActivity } from "../actions/anywhere";
import type { WorldCharacterState } from "../state";

export type WorldCharacterDefinition = {
  characterId: string;
  identities: readonly string[];
  familiarPlaceIds: readonly string[];
  initialPlaceId: string;
};

/** 世界身份与初始地图知识；名称仍由项目 characters 配置提供。 */
export const characterDefinitions: readonly WorldCharacterDefinition[] = [
  {
    characterId: "yuuno",
    identities: ["student"],
    familiarPlaceIds: ["town", "home"],
    initialPlaceId: "home_interior",
  },
];

/** 只用于首次创建；恢复时不得覆盖已保存的身体、资产与活动。 */
export function createCharacterState(
  definition: WorldCharacterDefinition,
  now: number,
): WorldCharacterState {
  return {
    characterId: definition.characterId,
    placeId: definition.initialPlaceId,
    stamina: 100,
    satiety: 70,
    money: 200,
    phoneBattery: 100,
    inventory: {},
    currentActivity: createIdleActivity(now),
  };
}
