import { type ActionAgentDecision, ActionId, type ActionMetadata, MajorScene } from "@yuiju/utils";

type CoastWalkTier = {
  durationMin: number;
  moodGain: number;
};

/**
 * 月汐海岸散步的固定时长档位。
 *
 * 设计说明：
 * - 复用与南风公园相同的收益模型，保持“方案 A”的一致体验；
 * - 使用离散档位而不是任意分钟数，避免 LLM 输出过碎的时长选择；
 * - 如果后续要增加“看海发呆 / 捡贝壳 / 吹海风”等行为，可以继续沿用这套档位解析逻辑。
 */
const COAST_WALK_TIERS: CoastWalkTier[] = [
  { durationMin: 10, moodGain: 2 },
  { durationMin: 30, moodGain: 5 },
  { durationMin: 60, moodGain: 9 },
  { durationMin: 120, moodGain: 15 },
];

const DEFAULT_COAST_WALK_TIER = COAST_WALK_TIERS[1];

/**
 * 判断角色是否位于月汐海岸。
 *
 * @param major 当前角色所在的大地点枚举值
 */
function isAtCoast(major: MajorScene) {
  return major === MajorScene.Coast;
}

/**
 * 将 LLM 给出的散步时长收敛到海岸支持的预设档位。
 *
 * @param llmDurationMin LLM 决策给出的分钟数，可为空或任意正数
 * @returns 与海岸散步规则匹配的最终档位
 */
function resolveCoastWalkTier(llmDurationMin?: number): CoastWalkTier {
  if (!llmDurationMin || llmDurationMin <= 0) {
    return DEFAULT_COAST_WALK_TIER;
  }

  return (
    COAST_WALK_TIERS.find((tier) => llmDurationMin <= tier.durationMin) ??
    COAST_WALK_TIERS[COAST_WALK_TIERS.length - 1]
  );
}

export const coastAction: ActionMetadata[] = [
  {
    action: ActionId.Walk_In_Coast,
    description:
      "在月汐海岸散步放松，可以按 10/30/60/120 分钟四档安排时长，时间越久心情提升越多。[耗时需要给出]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return isAtCoast(context.characterState.location.major);
    },
    async executor(context, selectedAction) {
      const selectedTier = resolveCoastWalkTier(selectedAction.durationMinute);

      await context.characterState.setAction(ActionId.Walk_In_Coast);

      return {
        executionResult: `开始在月汐海岸散步，预计${selectedTier.durationMin}分钟`,
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
        eventDescription: `在月汐海岸散步了${walkContext.durationMin}分钟，心情提升了${walkContext.moodGain}点`,
      };
    },
    async durationMin(_context, selectedAction?: ActionAgentDecision) {
      return resolveCoastWalkTier(selectedAction?.durationMinute).durationMin;
    },
  },
  {
    action: ActionId.Go_To_Shop_From_Coast,
    description: "从月汐海岸回到小町商店，路程较远。[体力-7][饱腹-5][耗时30分钟]",
    precondition(context) {
      return isAtCoast(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Shop_From_Coast);
      await context.characterState.setLocation({ major: MajorScene.Shop });
      await context.characterState.changeStamina(-7);
      await context.characterState.changeSatiety(-5);
    },
    durationMin: 30,
  },
];
