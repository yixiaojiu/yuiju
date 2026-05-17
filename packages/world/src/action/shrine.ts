import { ActionId, type ActionMetadata, allTrue, MajorScene, planManager } from "@yuiju/utils";
import { chooseShrinePrayerAgent } from "@/llm/agent";
import { isNight } from "./utils";

const SHRINE_OFFERING_COST = 5;
const SHRINE_PRAY_MOOD_GAIN = 4;
const SHRINE_OFFERING_MOOD_GAIN = 8;

function isAtShrine(major: MajorScene) {
  return major === MajorScene.Shrine;
}

export const shrineAction: ActionMetadata[] = [
  {
    action: ActionId.Pray_At_Shrine,
    description:
      "在结灯神社参拜，并由内心决定是否投币祈愿；若投币，会向神明说出一句愿望。[心情+?][耗时10分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([
        () => isAtShrine(context.characterState.location.major),
        () => !isNight(context),
      ]);
    },
    async executor(context, selectedAction) {
      await context.characterState.setAction(ActionId.Pray_At_Shrine);
      const prayerDecision = await chooseShrinePrayerAgent(
        context,
        [],
        await planManager.getState(),
        SHRINE_OFFERING_COST,
        selectedAction,
      );
      const shouldOffer =
        prayerDecision?.shouldOffer === true &&
        context.characterState.money >= SHRINE_OFFERING_COST;

      if (shouldOffer) {
        await context.characterState.changeMoney(-SHRINE_OFFERING_COST);

        const wish = prayerDecision?.wish?.trim();
        return {
          executionResult: wish
            ? `在结灯神社投了${SHRINE_OFFERING_COST}元香火钱，祈愿“${wish}”`
            : `在结灯神社投了${SHRINE_OFFERING_COST}元香火钱，认真祈愿`,
          startContext: {
            shouldOffer: true,
            wish,
            moodGain: SHRINE_OFFERING_MOOD_GAIN,
          },
        };
      }

      return {
        executionResult: "在结灯神社认真参拜",
        startContext: {
          shouldOffer: false,
          moodGain: SHRINE_PRAY_MOOD_GAIN,
        },
      };
    },
    async completionEvent(context, runningAction) {
      const prayContext = runningAction.startContext as {
        shouldOffer: boolean;
        wish?: string;
        moodGain: number;
      };

      await context.characterState.changeMood(prayContext.moodGain);

      if (prayContext.shouldOffer) {
        return {
          completionContext: prayContext,
          eventDescription: prayContext.wish
            ? `在结灯神社祈愿“${prayContext.wish}”，心情提升了${prayContext.moodGain}点`
            : `在结灯神社认真祈愿，心情提升了${prayContext.moodGain}点`,
        };
      }

      return {
        completionContext: prayContext,
        eventDescription: `在结灯神社认真参拜，心情提升了${prayContext.moodGain}点`,
      };
    },
    durationMin: 10,
  },
  {
    action: ActionId.Go_To_Park_From_Shrine,
    description: "从结灯神社回到南风公园。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return isAtShrine(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Park_From_Shrine);
      await context.characterState.setLocation({ major: MajorScene.Park });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
];
