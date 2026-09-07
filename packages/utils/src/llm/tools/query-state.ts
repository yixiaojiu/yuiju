import type { Tool } from "ai";
import dayjs from "dayjs";
import z from "zod";
import { formatPlanPrompt } from "../../prompt/world-view";
import { initCharacterStateData } from "../../redis/state/character";
import { initPlanStateData } from "../../redis/state/plan";
import { initWorldStateData } from "../../redis/state/world";
import { formatProjectTime } from "../../time";

export const queryStateTool: Tool = {
  description:
    "查询状态，包括当前时间、角色状态、世界天气，以及长期计划和短期计划。状态不会变化，短时间内只用调用一次。",
  inputSchema: z.object({}),
  execute: async () => {
    const characterState = await initCharacterStateData();
    const worldState = await initWorldStateData();
    const planState = await initPlanStateData();
    const now = dayjs();

    return {
      currentTime: formatProjectTime(now, "YYYY-MM-DD HH:mm dddd"),
      characterState,
      worldState: {
        lastAdvancedAt: worldState.lastAdvancedAt,
        weather: worldState.weather?.type,
        temperatureLevel: worldState.weather?.temperatureLevel,
        scenes: worldState.scenes,
      },
      planState: {
        longTermPlan: planState.longTermPlan ? formatPlanPrompt(planState.longTermPlan) : null,
        shortTermPlans: planState.shortTermPlans.map((plan) => formatPlanPrompt(plan)),
      },
    };
  },
};
