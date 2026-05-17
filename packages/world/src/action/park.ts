import {
  type ActionAgentDecision,
  ActionId,
  type ActionMetadata,
  allTrue,
  MajorScene,
} from "@yuiju/utils";
import { isNight } from "./utils";

type ParkWalkTier = {
  durationMin: number;
  moodGain: number;
};

/**
 * 南风公园散步的预设档位。
 *
 * 说明：
 * - 这里使用固定档位而不是任意分钟数，避免 LLM 给出过于离散的时长；
 * - 后续如果希望扩展成晨跑、赏花等行为，可以继续复用该档位映射逻辑。
 */
const PARK_WALK_TIERS: ParkWalkTier[] = [
  { durationMin: 10, moodGain: 2 },
  { durationMin: 30, moodGain: 5 },
  { durationMin: 60, moodGain: 9 },
  { durationMin: 120, moodGain: 15 },
];

const DEFAULT_PARK_WALK_TIER = PARK_WALK_TIERS[1];

function isAtPark(major: MajorScene) {
  return major === MajorScene.Park;
}

/**
 * 将 LLM 给出的任意时长收敛到南风公园支持的预设档位。
 *
 * 规则：
 * - 若未给出时长，则默认选择 30 分钟档；
 * - 若给出非档位值，则选择“不小于该时长的最小档位”；
 * - 若超过最大值，则钳制到 120 分钟档。
 */
function resolveParkWalkTier(llmDurationMin?: number): ParkWalkTier {
  if (!llmDurationMin || llmDurationMin <= 0) {
    return DEFAULT_PARK_WALK_TIER;
  }

  return (
    PARK_WALK_TIERS.find((tier) => llmDurationMin <= tier.durationMin) ??
    PARK_WALK_TIERS[PARK_WALK_TIERS.length - 1]
  );
}

export const parkAction: ActionMetadata[] = [
  {
    action: ActionId.Walk_In_Park,
    description:
      "在南风公园散步放松，可以按 10/30/60/120 分钟四档安排时长，时间越久心情提升越多。[耗时需要给出]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return isAtPark(context.characterState.location.major);
    },
    async executor(context, selectedAction) {
      const selectedTier = resolveParkWalkTier(selectedAction.durationMinute);
      await context.characterState.setAction(ActionId.Walk_In_Park);

      return {
        executionResult: `开始在南风公园散步，预计${selectedTier.durationMin}分钟`,
        startContext: {
          durationMin: selectedTier.durationMin,
          moodGain: selectedTier.moodGain,
        },
      };
    },
    async completionEvent(context, runningAction) {
      const walkContext = runningAction.startContext as {
        durationMin: number;
        moodGain: number;
      };
      await context.characterState.changeMood(walkContext.moodGain);
      return {
        completionContext: walkContext,
        eventDescription: `在南风公园散步了${walkContext.durationMin}分钟，心情提升了${walkContext.moodGain}点`,
      };
    },
    async durationMin(_context, selectedAction?: ActionAgentDecision) {
      return resolveParkWalkTier(selectedAction?.durationMinute).durationMin;
    },
  },
  {
    action: ActionId.Go_Home_From_Park,
    description: "从南风公园回家。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return isAtPark(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_Home_From_Park);
      await context.characterState.setLocation({ major: MajorScene.Home });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
  {
    action: ActionId.Go_To_Shrine_From_Park,
    description: "从南风公园前往结灯神社。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return allTrue([
        () => isAtPark(context.characterState.location.major),
        () => !isNight(context),
      ]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Shrine_From_Park);
      await context.characterState.setLocation({ major: MajorScene.Shrine });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
];
