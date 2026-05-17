import {
  type IWorldState,
  initWorldStateData,
  saveWorldStateData,
  type WeatherSnapshot,
  type WorldStateData,
} from "@yuiju/utils";
import dayjs, { type Dayjs } from "dayjs";
import { cloneDeep } from "lodash-es";

export class WorldState implements IWorldState {
  public time: Dayjs = dayjs();
  public weather: WeatherSnapshot | null = null;

  private static instance: WorldState | null = null;

  static getInstance() {
    if (!WorldState.instance) WorldState.instance = new WorldState();
    return WorldState.instance;
  }

  async load() {
    const data = await initWorldStateData();
    this.time = data.time;
    this.weather = data.weather;
  }

  async save() {
    await saveWorldStateData({
      time: this.time,
      weather: this.weather,
    });
  }

  public async updateTime(newTime?: Dayjs) {
    this.time = newTime || dayjs();
    await this.save();
  }

  /**
   * 持久化当前天气快照。
   *
   * 说明：
   * - 天气作为世界背景状态的一部分，与世界时间共享同一份 Redis Hash；
   * - 这里不负责生成天气，只负责更新当前真相源。
   */
  public async setWeather(snapshot: WeatherSnapshot) {
    this.weather = cloneDeep(snapshot);
    await this.save();
  }

  /**
   * 获取当前天气快照。
   *
   * 返回深拷贝，避免调用方直接修改内存态。
   */
  public getWeather(): WeatherSnapshot | null {
    return this.weather ? cloneDeep(this.weather) : null;
  }

  public async reset() {
    this.time = dayjs();
    this.weather = null;
    await this.save();
  }

  public log(): WorldStateData {
    return cloneDeep({
      time: this.time,
      weather: this.weather,
    });
  }
}

export const worldState = WorldState.getInstance();
