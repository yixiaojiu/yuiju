import { type BodyNeed, changeBody, type WorldCharacterState } from "../state";
import { type WorldAdvanceContext, WorldEvolution } from "./evolution";

/** 清醒时每 12 分钟扣 1 点饱腹（每小时 5 点）。 */
const satietyIntervalMs = 12 * 60_000;
/** 清醒时每 30 分钟扣 1 点体力（每小时 2 点）。 */
const staminaIntervalMs = 30 * 60_000;
/** 睡眠期间不消耗；醒来时由起床结算直接设定身体值。 */
const sleepActionIds = new Set(["睡觉", "再睡一会"]);

/** 身体随时间被动消耗；行动消耗只代表额外付出。 */
export class BodyEvolution extends WorldEvolution {
  precondition({ state, now }: WorldAdvanceContext): boolean {
    return Object.values(state.characters).some(
      (character) =>
        now - character.bodyClock.satiety >= satietyIntervalMs ||
        now - character.bodyClock.stamina >= staminaIntervalMs,
    );
  }

  advance({ state, now }: WorldAdvanceContext): void {
    for (const character of Object.values(state.characters)) {
      const satietySteps = Math.floor((now - character.bodyClock.satiety) / satietyIntervalMs);
      const staminaSteps = Math.floor((now - character.bodyClock.stamina) / staminaIntervalMs);
      character.bodyClock.satiety += satietySteps * satietyIntervalMs;
      character.bodyClock.stamina += staminaSteps * staminaIntervalMs;
      if (!sleepActionIds.has(character.currentActivity!.actionId)) {
        changeBody(character, -staminaSteps, -satietySteps);
      }
    }
  }
}

const needs: {
  need: BodyNeed;
  below: (character: WorldCharacterState) => boolean;
  description: string;
}[] = [
  {
    need: "hunger",
    below: (character) => character.satiety < 30,
    description: "你感觉肚子有点饿了。",
  },
  {
    need: "fatigue",
    below: (character) => character.stamina < 25,
    description: "你感觉身体有点累了。",
  },
];

/**
 * 需求跌破阈值时提醒一次，恢复到阈值以上后清除记录；睡眠期间不提醒。
 * 修改角色的提醒记录，返回本次需要通知的描述。
 */
export function checkBodyNeeds(character: WorldCharacterState): string[] {
  const descriptions: string[] = [];
  for (const { need, below, description } of needs) {
    if (!below(character)) {
      character.notifiedNeeds = character.notifiedNeeds.filter((item) => item !== need);
      continue;
    }
    if (
      character.notifiedNeeds.includes(need) ||
      sleepActionIds.has(character.currentActivity!.actionId)
    ) {
      continue;
    }
    character.notifiedNeeds.push(need);
    descriptions.push(description);
  }
  return descriptions;
}
