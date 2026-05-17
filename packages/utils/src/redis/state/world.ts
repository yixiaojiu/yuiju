import dayjs from "dayjs";
import { isDev } from "../../env";
import {
  TEMPERATURE_LEVELS,
  WEATHER_TYPES,
  type WeatherSnapshot,
  type WorldStateData,
} from "../../types";
import { safeParseJson } from "../../utils";
import { getRedis, type RedisReadSource, syncRedisStateWrite } from "../client";

export const REDIS_KEY_WORLD_STATE = isDev() ? "dev:yuiju:world:state" : "yuiju:world:state";

type InitWorldStateDataOptions = {
  readFrom?: RedisReadSource;
};

const isValidIsoDateString = (value: unknown): value is string => {
  return typeof value === "string" && dayjs(value).isValid();
};

const isWeatherType = (value: unknown): value is WeatherSnapshot["type"] => {
  return typeof value === "string" && WEATHER_TYPES.includes(value as WeatherSnapshot["type"]);
};

const isTemperatureLevel = (value: unknown): value is WeatherSnapshot["temperatureLevel"] => {
  return (
    typeof value === "string" &&
    TEMPERATURE_LEVELS.includes(value as WeatherSnapshot["temperatureLevel"])
  );
};

const parseWeatherSnapshot = (value: unknown): WeatherSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeWeather = value as Partial<WeatherSnapshot>;

  if (!isWeatherType(maybeWeather.type)) {
    return null;
  }

  if (!isTemperatureLevel(maybeWeather.temperatureLevel)) {
    return null;
  }

  if (!isValidIsoDateString(maybeWeather.periodStartAt)) {
    return null;
  }

  if (!isValidIsoDateString(maybeWeather.periodEndAt)) {
    return null;
  }

  if (!isValidIsoDateString(maybeWeather.updatedAt)) {
    return null;
  }

  return {
    type: maybeWeather.type,
    temperatureLevel: maybeWeather.temperatureLevel,
    periodStartAt: maybeWeather.periodStartAt,
    periodEndAt: maybeWeather.periodEndAt,
    updatedAt: maybeWeather.updatedAt,
  };
};

export const initWorldStateData = async (
  options: InitWorldStateDataOptions = {},
): Promise<WorldStateData> => {
  const readFrom = options.readFrom ?? "primary";
  const redis = getRedis(readFrom);
  const raw = await redis.hgetall(REDIS_KEY_WORLD_STATE);
  const timeStr = raw.time;

  if (!timeStr) {
    const time = dayjs();
    if (readFrom === "sync") {
      return { time, weather: null };
    }

    const timeValue = time.toISOString();
    await redis.hset(REDIS_KEY_WORLD_STATE, "time", timeValue);
    await syncRedisStateWrite({
      command: "hset",
      key: REDIS_KEY_WORLD_STATE,
      fields: { time: timeValue },
    });
    return { time, weather: null };
  }

  const parsed = dayjs(timeStr);
  if (!parsed.isValid()) {
    const time = dayjs();
    if (readFrom === "sync") {
      return { time, weather: null };
    }

    const timeValue = time.toISOString();
    await redis.hset(REDIS_KEY_WORLD_STATE, "time", timeValue);
    await syncRedisStateWrite({
      command: "hset",
      key: REDIS_KEY_WORLD_STATE,
      fields: { time: timeValue },
    });
    return { time, weather: null };
  }

  const weather = raw.weather ? parseWeatherSnapshot(safeParseJson(raw.weather)) : null;

  return {
    time: parsed,
    weather,
  };
};

export const saveWorldStateData = async (state: WorldStateData): Promise<void> => {
  const redis = getRedis();
  const worldStateFields = {
    time: state.time.toISOString(),
    weather: JSON.stringify(state.weather),
  };

  await redis.hset(REDIS_KEY_WORLD_STATE, worldStateFields);
  await syncRedisStateWrite({
    command: "hset",
    key: REDIS_KEY_WORLD_STATE,
    fields: worldStateFields,
  });
};
