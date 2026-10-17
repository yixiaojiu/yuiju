import { createIdleActivity } from "../actions/anywhere";
import type { WorldCharacterState } from "../state";

export type WorldCharacterDefinition = {
  characterId: string;
  identities: readonly string[];
  familiarPlaceIds: readonly string[];
  initialPlaceId: string;
};

/** 住宅 ID 只由角色 ID 决定，不随名称、排序或角色数量改变。 */
export function getHomePlaceIds(characterId: string) {
  const homeId = `home:${encodeURIComponent(characterId)}`;
  return { homeId, interiorId: `${homeId}:interior` };
}

/** 身份由配置提供；角色熟悉公共小镇和自己的住宅，首次从自家屋内开始生活。 */
export function createCharacterDefinition(
  characterId: string,
  identities: readonly string[] = [],
): WorldCharacterDefinition {
  const { homeId, interiorId } = getHomePlaceIds(characterId);
  return {
    characterId,
    identities,
    familiarPlaceIds: ["town", homeId],
    initialPlaceId: interiorId,
  };
}

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
