import dayjs from "dayjs";
import { isDev } from "../../env";
import {
  ActionId,
  type CharacterStateData,
  type Location,
  MajorScene,
  type RunningActionState,
} from "../../types";
import { safeParseJson } from "../../utils";
import { getRedis, type RedisReadSource, syncRedisStateWrite } from "../client";

export const REDIS_KEY_CHARACTER_STATE = isDev()
  ? "dev:yuiju:charactor:state"
  : "yuiju:charactor:state";

const DEFAULT_CHARACTER_STATE_DATA: CharacterStateData = {
  action: ActionId.Idle,
  location: { major: MajorScene.Home },
  stamina: 100,
  satiety: 70,
  mood: 60,
  money: 0,
  dailyActionsDoneToday: [],
  inventory: [],
  runningAction: null,
};

type InitCharacterStateDataOptions = {
  readFrom?: RedisReadSource;
};

const isActionId = (value: string): value is ActionId => {
  return (Object.values(ActionId) as string[]).includes(value);
};

const isMajorScene = (value: unknown): value is MajorScene => {
  return typeof value === "string" && (Object.values(MajorScene) as string[]).includes(value);
};

const isValidIsoDateString = (value: unknown): value is string => {
  return typeof value === "string" && dayjs(value).isValid();
};

const parseRunningActionState = (value: unknown): RunningActionState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeRunningAction = value as Partial<RunningActionState>;

  if (!maybeRunningAction.action || !isActionId(maybeRunningAction.action)) {
    return null;
  }

  if (!isValidIsoDateString(maybeRunningAction.actionStartedAt)) {
    return null;
  }

  if (!isValidIsoDateString(maybeRunningAction.waitUntil)) {
    return null;
  }

  if (typeof maybeRunningAction.behaviorEpisodeId !== "string") {
    return null;
  }

  if (
    maybeRunningAction.startContext !== undefined &&
    (!maybeRunningAction.startContext ||
      typeof maybeRunningAction.startContext !== "object" ||
      Array.isArray(maybeRunningAction.startContext))
  ) {
    return null;
  }

  return {
    action: maybeRunningAction.action,
    actionStartedAt: maybeRunningAction.actionStartedAt,
    waitUntil: maybeRunningAction.waitUntil,
    behaviorEpisodeId: maybeRunningAction.behaviorEpisodeId,
    startContext: maybeRunningAction.startContext,
  };
};

export const saveCharacterStateData = async (state: CharacterStateData): Promise<void> => {
  const redis = getRedis();
  const characterStateFields = {
    action: state.action,
    location: JSON.stringify(state.location),
    stamina: state.stamina,
    satiety: state.satiety,
    mood: state.mood,
    money: state.money,
    dailyActionsDoneToday: JSON.stringify(state.dailyActionsDoneToday),
    inventory: JSON.stringify(state.inventory ?? []),
    runningAction: JSON.stringify(state.runningAction),
  };

  await redis.hset(REDIS_KEY_CHARACTER_STATE, characterStateFields);
  await syncRedisStateWrite({
    command: "hset",
    key: REDIS_KEY_CHARACTER_STATE,
    fields: characterStateFields,
  });
};

export const initCharacterStateData = async (
  options: InitCharacterStateDataOptions = {},
): Promise<CharacterStateData> => {
  const readFrom = options.readFrom ?? "primary";
  const redis = getRedis(readFrom);
  const raw = await redis.hgetall(REDIS_KEY_CHARACTER_STATE);

  if (Object.keys(raw).length === 0) {
    if (readFrom === "sync") {
      return { ...DEFAULT_CHARACTER_STATE_DATA };
    }

    await saveCharacterStateData(DEFAULT_CHARACTER_STATE_DATA);
    return { ...DEFAULT_CHARACTER_STATE_DATA };
  }

  const state: CharacterStateData = {
    ...DEFAULT_CHARACTER_STATE_DATA,
    dailyActionsDoneToday: [...DEFAULT_CHARACTER_STATE_DATA.dailyActionsDoneToday],
    inventory: [...(DEFAULT_CHARACTER_STATE_DATA.inventory ?? [])],
    runningAction: DEFAULT_CHARACTER_STATE_DATA.runningAction,
  };

  if (raw.action && isActionId(raw.action)) {
    state.action = raw.action;
  }

  if (raw.location) {
    const parsedLocation = safeParseJson<unknown>(raw.location);
    if (
      parsedLocation &&
      typeof parsedLocation === "object" &&
      "major" in parsedLocation &&
      isMajorScene((parsedLocation as any).major)
    ) {
      state.location = parsedLocation as Location;
    }
  }

  if (raw.stamina) {
    const stamina = Number.parseInt(raw.stamina, 10);
    if (Number.isFinite(stamina)) state.stamina = stamina;
  }

  if (raw.satiety) {
    const satiety = Number.parseInt(raw.satiety, 10);
    if (Number.isFinite(satiety)) state.satiety = satiety;
  }

  if (raw.mood) {
    const mood = Number.parseInt(raw.mood, 10);
    if (Number.isFinite(mood)) state.mood = mood;
  }

  if (raw.money) {
    const money = Number.parseInt(raw.money, 10);
    if (Number.isFinite(money)) state.money = money;
  }

  if (raw.dailyActionsDoneToday) {
    const parsedDaily = safeParseJson<unknown>(raw.dailyActionsDoneToday);
    if (Array.isArray(parsedDaily)) {
      state.dailyActionsDoneToday = parsedDaily
        .filter((item): item is string => typeof item === "string")
        .filter((item): item is ActionId => isActionId(item));
    } else {
      state.dailyActionsDoneToday = [];
    }
  }

  if (raw.inventory) {
    const parsedInventory = safeParseJson<unknown>(raw.inventory);
    if (Array.isArray(parsedInventory)) {
      state.inventory = parsedInventory as NonNullable<CharacterStateData["inventory"]>;
    } else {
      state.inventory = [];
    }
  }

  if (raw.runningAction) {
    const parsedRunningAction = safeParseJson<unknown>(raw.runningAction);
    state.runningAction = parseRunningActionState(parsedRunningAction);
  }

  return state;
};

export const changeCharacterMoney = async (
  amount: number,
): Promise<{ previousMoney: number; currentMoney: number; delta: number }> => {
  const redis = getRedis();
  const currentMoney = await redis.hincrby(REDIS_KEY_CHARACTER_STATE, "money", amount);

  return {
    previousMoney: currentMoney - amount,
    currentMoney,
    delta: amount,
  };
};

export const setCharacterMoney = async (
  amount: number,
): Promise<{ previousMoney: number; currentMoney: number; delta: number }> => {
  const redis = getRedis();
  const results = await redis
    .multi()
    .hget(REDIS_KEY_CHARACTER_STATE, "money")
    .hset(REDIS_KEY_CHARACTER_STATE, "money", amount)
    .hget(REDIS_KEY_CHARACTER_STATE, "money")
    .exec();

  if (!results) {
    throw new Error("redis transaction failed");
  }

  const [oldErr, oldValue] = results?.[0] ?? [];
  const [setErr] = results?.[1] ?? [];
  const [newErr, newValue] = results?.[2] ?? [];

  if (oldErr || setErr || newErr) {
    throw oldErr || setErr || newErr;
  }

  const previousMoney = Number.parseInt(String(oldValue ?? "0"), 10);
  const currentMoney = Number.parseInt(String(newValue ?? "0"), 10);

  return {
    previousMoney,
    currentMoney,
    delta: currentMoney - previousMoney,
  };
};

export const syncCharacterMoney = async (money: number): Promise<void> => {
  await syncRedisStateWrite({
    command: "hset",
    key: REDIS_KEY_CHARACTER_STATE,
    fields: { money },
  });
};
