import type { Tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "../../logger";
import { initCharacterStateData, initPlanStateData, initWorldStateData } from "../../redis";
import { getTimeWithWeekday } from "../../time";

export const queryStateTool: Tool = {
  description:
    "查询状态，包括当前时间、角色状态、世界天气，以及长期计划和短期计划。短时间内状态不会变化，短时间内只用调用一次。",
  inputSchema: z.object({}),
  execute: async () => {
    const characterState = await initCharacterStateData();
    const worldState = await initWorldStateData();
    const planState = await initPlanStateData();
    const now = dayjs();

    logger.info("[工具调用]", "queryState");

    return {
      currentTime: getTimeWithWeekday(now, "MM-DD HH:mm"),
      characterState,
      worldState: {
        weather: worldState.weather?.type,
        temperatureLevel: worldState.weather?.temperatureLevel,
      },
      planState: {
        longTermPlan: planState.longTermPlan?.title ?? null,
        shortTermPlans: planState.shortTermPlans.map((plan) => plan.title),
      },
    };
  },
};
