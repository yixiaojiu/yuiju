import type { Dayjs } from "dayjs";
import type { ActionId, ActionProactiveShareIntent } from "./action";
import type { WeatherSnapshot } from "./weather";

// 大场景
export enum MajorScene {
  Home = "家",
  School = "星见丘高校",
  Shop = "小町商店",
  Cafe = "薄暮咖啡馆",
  Park = "南风公园",
  Shrine = "结灯神社",
  Coast = "月汐海岸",
}

// 家的小场景
export enum HomeSubScene {
  House = "house",
}

// 星见丘高校的小场景
export enum SchoolSubScene {}

// 小町商店的小场景（预留）
export enum ShopSubScene {}

// 南风公园的小场景（预留）
export enum ParkSubScene {}

// 结灯神社的小场景（预留）
export enum ShrineSubScene {}

// 海岸的小场景（预留）
export enum CoastSubScene {}

// 位置类型（判别联合）
export type Location =
  | { major: MajorScene.Home; minor?: HomeSubScene }
  | { major: MajorScene.School; minor?: SchoolSubScene }
  | { major: MajorScene.Shop; minor?: ShopSubScene }
  | { major: MajorScene.Cafe; minor?: undefined }
  | { major: MajorScene.Park; minor?: ParkSubScene }
  | { major: MajorScene.Shrine; minor?: ShrineSubScene }
  | { major: MajorScene.Coast; minor?: CoastSubScene };

/**
 * 食物元数据
 */
export interface FoodMetadata {
  /** 体力恢复值 */
  stamina?: number;
  /** 饱腹度恢复值 */
  satiety?: number;
  /** 心情恢复值 */
  mood?: number;
}

/**
 * @description 预留
 * 材料元数据
 */
export type MaterialMetadata = {};

/**
 * 物品接口（判别联合类型）
 */
export type InventoryItem = {
  /** 物品名称 */
  name: string;
  /** 物品描述 */
  description: string;
  /** 物品类别 */
  category: "food" | "material";
  /** 数量 */
  quantity: number;
  /** 食物元数据 */
  metadata: FoodMetadata | MaterialMetadata;
};

/**
 * 运行中的 action 等待上下文。
 *
 * 说明：
 * - `actionStartedAt` 表示本次 action 开始执行的时间；
 * - `waitUntil` 表示本次等待逻辑应结束的绝对时间，用于进程重启后恢复剩余等待时长；
 * - `behaviorEpisodeId` 指向开始阶段写入的 running 行为 Episode；
 * - `startContext` 保存完成结算必须使用的开始上下文。
 */
export interface RunningActionState {
  /** 当前正在经历等待阶段的 action */
  action: ActionId;
  /** action 开始执行时间 */
  actionStartedAt: string;
  /** 等待逻辑的目标结束时间 */
  waitUntil: string;
  /** 开始阶段写入的 behavior Episode id */
  behaviorEpisodeId: string;
  /** 完成结算需要读取的开始上下文 */
  startContext?: Record<string, unknown>;
  /** Action 决策阶段产生的主动分享意图 */
  proactiveShareIntent?: ActionProactiveShareIntent;
}

export interface CharacterStateData {
  action: ActionId;
  location: Location;
  /**体力值 */
  stamina: number;
  /** 饱腹度 */
  satiety: number;
  /** 心情 */
  mood: number;
  /** 金钱 */
  money: number;
  /** 今日已执行的动作列表 */
  dailyActionsDoneToday: ActionId[];
  /** 背包物品列表 */
  inventory?: InventoryItem[];
  /** 运行中的 action 等待上下文 */
  runningAction: RunningActionState | null;
}

export interface ICharacterState extends CharacterStateData {
  setAction(action: ActionId): Promise<void>;
  /** 设置体力值 */
  setStamina(stamina: number): Promise<void>;
  setSatiety(satiety: number): Promise<void>;
  setMood(mood: number): Promise<void>;
  setLocation(location: Location): Promise<void>;
  /** 改变体力值 */
  changeStamina(delta: number): Promise<void>;
  changeSatiety(delta: number): Promise<void>;
  changeMood(delta: number): Promise<void>;
  /** 改变金钱 */
  changeMoney(delta: number): Promise<void>;
  /** 标记该动作已在今天执行 */
  markActionDoneToday(action: ActionId): Promise<void>;
  /** 清空今日动作 */
  clearDailyActions(): Promise<void>;
  /** 获取状态日志（深拷贝） */
  log(): CharacterStateData;
  /**
   * 写入运行中的 action 等待上下文。
   *
   * 该上下文会在 action 执行完成、进入等待前落盘，
   * 供程序重启后恢复剩余等待时间。
   */
  setRunningAction(runningAction: RunningActionState): Promise<void>;
  /** 清除运行中的 action 等待上下文。 */
  clearRunningAction(): Promise<void>;
  /** 获取当前运行中的 action 等待上下文。 */
  getRunningAction(): RunningActionState | null;

  /** 背包管理方法 */
  /** 添加物品到背包 */
  addItem(item: Omit<InventoryItem, "quantity">, quantity?: number): Promise<void>;
  /** 消费背包中的物品 */
  consumeItem(itemName: string, quantity?: number): Promise<boolean>;
  /** 获取背包中指定物品的数量 */
  getItemQuantity(itemName: string): number;
}

export interface WorldStateData {
  time: Dayjs;
  weather: WeatherSnapshot | null;
}

export interface IWorldState extends WorldStateData {
  log(): WorldStateData;
  updateTime(newTime?: Dayjs): Promise<void>;
  setWeather(snapshot: WeatherSnapshot): Promise<void>;
  getWeather(): WeatherSnapshot | null;
  reset(): Promise<void>;
}
