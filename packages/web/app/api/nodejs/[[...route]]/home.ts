import {
  getYuijuConfig,
  initCharacterStateData,
  initPlanStateData,
  initWorldStateData,
  type RedisReadSource,
  worldMapLinks,
  worldMapPlaces,
  worldMapTerminalUi,
} from "@yuiju/utils";
import { Hono } from "hono";

export const homeRoute = new Hono();

const STAMINA_MAX = 100;

// 语义化的响应类型名称
export interface HomeResponse {
  code: number;
  message: string;
  data: {
    status?: {
      behavior?: string;
      location?: string;
      stamina?: { current?: number; max?: number };
      satiety?: number;
      mood?: number;
      money?: number;
    };
    todayActions?: string[];
    inventory?: { name: string; count: number }[];
    plans?: { longTerm?: string; shortTerm?: string[] };
    world?: {
      time?: string;
      weather?: {
        type?: string;
        temperatureLevel?: string;
        periodStartAt?: string;
        periodEndAt?: string;
        updatedAt?: string;
      };
    };
  };
}

export interface HomeMapResponse {
  code: number;
  message: string;
  data: {
    places: typeof worldMapPlaces;
    links: typeof worldMapLinks;
    terminalUi: string;
  };
}

/**
 * 构建首页接口使用的世界状态响应。
 *
 * 说明：
 * - 将 Redis/领域层的 WorldStateData 收敛为前端稳定消费的序列化结构；
 * - 单独抽成纯函数，便于后续为 Web 聚合层补测试。
 */
export function buildHomeWorldPayload(world: Awaited<ReturnType<typeof initWorldStateData>>) {
  return {
    time: world.time.format("YYYY-MM-DD HH:mm"),
    weather: world.weather
      ? {
          type: world.weather.type,
          temperatureLevel: world.weather.temperatureLevel,
          periodStartAt: world.weather.periodStartAt,
          periodEndAt: world.weather.periodEndAt,
          updatedAt: world.weather.updatedAt,
        }
      : undefined,
  };
}

homeRoute.get("/summary", async (context) => {
  // 核心逻辑：角色状态、计划状态、世界时间分别来自不同真相源，首页聚合时统一读取。
  const readFrom: RedisReadSource = getYuijuConfig().app.publicDeployment ? "sync" : "primary";
  const [state, planState, world] = await Promise.all([
    initCharacterStateData({ readFrom }),
    initPlanStateData({ readFrom }),
    initWorldStateData({ readFrom }),
  ]);

  const inventory =
    state.inventory?.map((item) => ({
      name: item.name,
      count: Number.isFinite(item.quantity) ? item.quantity : 0,
    })) ?? [];

  const staminaMax = Math.max(STAMINA_MAX, state.stamina);

  return context.json({
    code: 0,
    data: {
      status: {
        behavior: state.action,
        location: state.location.major,
        stamina: { current: state.stamina, max: staminaMax },
        satiety: state.satiety,
        mood: state.mood,
        money: state.money,
      },
      todayActions: state.dailyActionsDoneToday,
      inventory,
      plans: {
        longTerm: planState.longTermPlan?.title,
        shortTerm: planState.shortTermPlans.map((plan) => plan.title),
      },
      world: buildHomeWorldPayload(world),
    },
    message: "ok",
  });
});

homeRoute.get("/map", async (context) => {
  return context.json({
    code: 0,
    data: {
      places: worldMapPlaces,
      links: worldMapLinks,
      terminalUi: worldMapTerminalUi,
    },
    message: "ok",
  } satisfies HomeMapResponse);
});
