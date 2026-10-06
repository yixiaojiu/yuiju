import { createHash } from "node:crypto";
import type { WeatherState } from "../state";
import { type WorldAdvanceContext, WorldEvolution } from "./evolution";
import { localTimestamp, worldTime } from "./time";

export type WeatherType = "晴" | "多云" | "阴" | "小雨" | "雨" | "雷雨" | "雪" | "雾";
export type TemperatureLevel = "严寒" | "寒冷" | "清凉" | "舒适" | "温暖" | "炎热";
type Season = "spring" | "summer" | "autumn" | "winter";
type Rng = () => number;
type WeightedMap<T extends string> = Record<T, number>;

/** 逐个补齐到期天气时段，保留天气惯性和每次实际变化。 */
export class WeatherEvolution extends WorldEvolution {
  precondition({ state, now, timezone }: WorldAdvanceContext): boolean {
    return nextWeatherPeriod(state.weatherPeriod, timezone) <= now;
  }

  advance({ state, now, timezone, events }: WorldAdvanceContext): void {
    let period = nextWeatherPeriod(state.weatherPeriod, timezone);
    while (period <= now) {
      const previous = state.weather;
      state.weather = generateWeather(
        period,
        { period: state.weatherPeriod, weather: previous },
        timezone,
      );
      state.weatherPeriod = period;
      if (
        state.weather.type !== previous.type ||
        state.weather.temperatureLevel !== previous.temperatureLevel
      ) {
        events.push({
          occurredAt: period,
          type: "weather_changed",
          characterId: null,
          placeId: null,
          activity: null,
          description: `天气变为${state.weather.type}，体感${state.weather.temperatureLevel}`,
        });
      }
      period = nextWeatherPeriod(period, timezone);
    }
  }
}

/** 按当地日历的 00/06/12/18 点划分天气时段。 */
export function weatherPeriod(timestamp: number, timezone: string): number {
  const time = worldTime(timestamp, timezone);
  return localTimestamp(time.format("YYYY-MM-DD"), Math.floor(time.hour() / 6) * 6, 0, timezone);
}
export function nextWeatherPeriod(timestamp: number, timezone: string): number {
  const time = worldTime(timestamp, timezone);
  const hour = Math.floor(time.hour() / 6) * 6 + 6;
  const date = (hour === 24 ? time.add(1, "day") : time).format("YYYY-MM-DD");
  return localTimestamp(date, hour % 24, 0, timezone);
}

/** 时间片与上一片天气决定随机种子；恢复按时间片补算，不按秒重放。 */
export function generateWeather(
  period: number,
  previous: { period: number; weather: WeatherState } | null,
  timezone: string,
): WeatherState {
  const seed = [
    new Date(period).toISOString(),
    previous ? new Date(previous.period).toISOString() : "none",
    previous?.weather.type ?? "none",
    previous?.weather.temperatureLevel ?? "none",
  ].join("|");
  let randomState = createHash("sha256").update(seed).digest().readUInt32BE(0);
  const rng = () => {
    randomState += 0x6d2b79f5;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const month = worldTime(period, timezone).month() + 1;
  const type = generateWeatherType(resolveSeason(month), previous?.weather.type, rng);
  return { type, temperatureLevel: generateTemperatureLevel(month, type, rng) };
}

type WeightedWeatherMap = Record<WeatherType, number>;
type WeightedTemperatureMap = Record<TemperatureLevel, number>;

const monthlyWeatherWeights: Record<"spring" | "summer" | "autumn" | "winter", WeightedWeatherMap> =
  {
    spring: { 晴: 24, 多云: 26, 阴: 20, 小雨: 16, 雨: 10, 雷雨: 1, 雪: 0, 雾: 3 },
    summer: { 晴: 22, 多云: 18, 阴: 15, 小雨: 14, 雨: 16, 雷雨: 11, 雪: 0, 雾: 4 },
    autumn: { 晴: 28, 多云: 20, 阴: 20, 小雨: 12, 雨: 8, 雷雨: 2, 雪: 0, 雾: 10 },
    winter: { 晴: 18, 多云: 12, 阴: 24, 小雨: 6, 雨: 6, 雷雨: 0, 雪: 24, 雾: 10 },
  };

const monthlyTemperatureWeights: Record<
  "spring" | "summer" | "autumn" | "winter",
  WeightedTemperatureMap
> = {
  spring: { 严寒: 2, 寒冷: 18, 清凉: 36, 舒适: 34, 温暖: 10, 炎热: 0 },
  summer: { 严寒: 0, 寒冷: 0, 清凉: 10, 舒适: 28, 温暖: 22, 炎热: 40 },
  autumn: { 严寒: 0, 寒冷: 8, 清凉: 28, 舒适: 42, 温暖: 20, 炎热: 2 },
  winter: { 严寒: 35, 寒冷: 40, 清凉: 20, 舒适: 5, 温暖: 0, 炎热: 0 },
};

const weatherInertiaAdjustments: Record<string, number> = {
  "晴->晴": 25,
  "多云->多云": 25,
  "阴->阴": 25,
  "小雨->小雨": 24,
  "雨->雨": 25,
  "雷雨->雷雨": 18,
  "雪->雪": 25,
  "雾->雾": 16,
  "晴->多云": 14,
  "多云->晴": 14,
  "多云->阴": 14,
  "阴->多云": 14,
  "阴->小雨": 12,
  "小雨->阴": 12,
  "小雨->雨": 12,
  "雨->小雨": 12,
  "雨->雷雨": 10,
  "雷雨->雨": 10,
  "阴->雾": 10,
  "雾->阴": 10,
  "多云->雾": 8,
  "雾->多云": 8,
  "阴->雪": 10,
  "雪->阴": 10,
  "小雨->雪": 6,
  "雪->小雨": 6,
  "晴->阴": 4,
  "阴->晴": 4,
  "晴->小雨": -4,
  "小雨->晴": -2,
  "晴->雨": -10,
  "雨->晴": -8,
  "晴->雷雨": -16,
  "雷雨->晴": -12,
  "晴->雪": -20,
  "雪->晴": -18,
};

function resolveSeason(month: number): Season {
  if (month >= 3 && month <= 5) {
    return "spring";
  }

  if (month >= 6 && month <= 8) {
    return "summer";
  }

  if (month >= 9 && month <= 11) {
    return "autumn";
  }

  return "winter";
}

function generateWeatherType(
  season: Season,
  previousType: WeatherType | undefined,
  rng: Rng,
): WeatherType {
  const weightedWeatherMap = { ...monthlyWeatherWeights[season] };

  if (previousType) {
    for (const currentType of Object.keys(weightedWeatherMap) as WeatherType[]) {
      const transitionKey = `${previousType}->${currentType}`;
      weightedWeatherMap[currentType] = Math.max(
        0,
        weightedWeatherMap[currentType] + (weatherInertiaAdjustments[transitionKey] ?? 0),
      );
    }
  }

  // 季节限制高于天气惯性：非冬季不下雪，冬季不产生雷雨。
  applySeasonWeatherConstraints(season, weightedWeatherMap);

  return pickWeightedValue(weightedWeatherMap, rng);
}

function applySeasonWeatherConstraints(
  season: Season,
  weightedWeatherMap: WeightedMap<WeatherType>,
): void {
  if (season !== "winter") {
    weightedWeatherMap.雪 = 0;
  }

  if (season === "winter") {
    weightedWeatherMap.雷雨 = 0;
  }
}

function generateTemperatureLevel(
  month: number,
  weatherType: WeatherType,
  rng: Rng,
): TemperatureLevel {
  const season = resolveSeason(month);
  const weightedTemperatureMap = { ...monthlyTemperatureWeights[season] };

  applyWeatherTemperatureAdjustments(season, weatherType, weightedTemperatureMap);

  return pickWeightedValue(weightedTemperatureMap, rng);
}

function applyWeatherTemperatureAdjustments(
  season: Season,
  weatherType: WeatherType,
  weightedTemperatureMap: WeightedMap<TemperatureLevel>,
): void {
  switch (weatherType) {
    case "晴": {
      if (season === "summer") {
        weightedTemperatureMap.严寒 = 0;
        weightedTemperatureMap.寒冷 = 0;
        weightedTemperatureMap.温暖 += 18;
        weightedTemperatureMap.炎热 += 28;
      } else if (season === "winter") {
        weightedTemperatureMap.舒适 = 0;
        weightedTemperatureMap.温暖 = 0;
        weightedTemperatureMap.炎热 = 0;
        weightedTemperatureMap.严寒 += 10;
        weightedTemperatureMap.寒冷 += 15;
      } else {
        weightedTemperatureMap.舒适 += 6;
        weightedTemperatureMap.温暖 += 4;
      }
      break;
    }

    case "多云": {
      if (season === "summer") {
        weightedTemperatureMap.严寒 = 0;
        weightedTemperatureMap.寒冷 = 0;
        weightedTemperatureMap.温暖 += 10;
        weightedTemperatureMap.炎热 += 12;
      } else if (season === "winter") {
        weightedTemperatureMap.温暖 = 0;
        weightedTemperatureMap.炎热 = 0;
        weightedTemperatureMap.舒适 = Math.max(0, weightedTemperatureMap.舒适 - 4);
        weightedTemperatureMap.寒冷 += 8;
      } else {
        weightedTemperatureMap.舒适 += 6;
      }
      break;
    }

    case "阴": {
      if (season === "winter") {
        weightedTemperatureMap.温暖 = 0;
        weightedTemperatureMap.炎热 = 0;
        weightedTemperatureMap.严寒 += 6;
        weightedTemperatureMap.寒冷 += 10;
      } else if (season === "summer") {
        weightedTemperatureMap.炎热 = Math.max(0, weightedTemperatureMap.炎热 - 8);
        weightedTemperatureMap.舒适 += 4;
      } else {
        weightedTemperatureMap.清凉 += 4;
      }
      break;
    }

    case "雾": {
      weightedTemperatureMap.炎热 = 0;
      weightedTemperatureMap.温暖 = Math.max(0, weightedTemperatureMap.温暖 - 10);
      weightedTemperatureMap.清凉 += 18;
      if (season === "winter") {
        weightedTemperatureMap.严寒 += 8;
      } else {
        weightedTemperatureMap.舒适 += 4;
      }
      break;
    }

    case "小雨": {
      weightedTemperatureMap.炎热 = 0;
      weightedTemperatureMap.温暖 = Math.max(0, weightedTemperatureMap.温暖 - 12);
      weightedTemperatureMap.清凉 += 12;
      weightedTemperatureMap.寒冷 += season === "winter" ? 10 : 4;
      break;
    }

    case "雨": {
      weightedTemperatureMap.炎热 = 0;
      weightedTemperatureMap.温暖 = Math.max(0, weightedTemperatureMap.温暖 - 18);
      weightedTemperatureMap.舒适 = Math.max(0, weightedTemperatureMap.舒适 - 8);
      weightedTemperatureMap.清凉 += 14;
      weightedTemperatureMap.寒冷 += season === "winter" ? 12 : 6;
      break;
    }

    case "雷雨": {
      weightedTemperatureMap.炎热 = 0;
      weightedTemperatureMap.温暖 = Math.max(0, weightedTemperatureMap.温暖 - 20);
      weightedTemperatureMap.舒适 = Math.max(0, weightedTemperatureMap.舒适 - 10);
      weightedTemperatureMap.清凉 += 18;
      weightedTemperatureMap.寒冷 += season === "summer" ? 4 : 8;
      break;
    }

    case "雪": {
      weightedTemperatureMap.清凉 = 0;
      weightedTemperatureMap.舒适 = 0;
      weightedTemperatureMap.温暖 = 0;
      weightedTemperatureMap.炎热 = 0;
      weightedTemperatureMap.严寒 += 30;
      weightedTemperatureMap.寒冷 += 20;
      break;
    }
  }
}

function pickWeightedValue<T extends string>(weights: Record<T, number>, rng: Rng): T {
  const entries = Object.entries(weights) as [T, number][];
  let cursor = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) {
      return value;
    }
  }
  throw new Error("天气权重必须包含正数且覆盖抽样范围");
}
