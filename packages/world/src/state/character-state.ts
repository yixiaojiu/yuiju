import {
  ActionId,
  type CharacterStateData,
  type ICharacterState,
  type InventoryItem,
  initCharacterStateData,
  type Location,
  MajorScene,
  type RunningActionState,
  saveCharacterStateData,
} from "@yuiju/utils";
import { cloneDeep } from "lodash-es";

const MAX_STAMINA = 100;
const MAX_SATIETY = 100;
const MAX_MOOD = 100;

export class CharacterState implements ICharacterState {
  private static instance: CharacterState | null = null;

  public action: ActionId = ActionId.Idle;
  public location: Location = { major: MajorScene.Home };
  public stamina: number = 100;
  public satiety: number = 70;
  public mood: number = 60;
  public money: number = 0;
  // 仅作内存缓存或只读展示，实际数据源为 Redis String (JSON)
  public dailyActionsDoneToday: ActionId[] = [];
  /** 背包物品列表 */
  public inventory: InventoryItem[] = [];
  /** 当前运行中的 action 等待上下文 */
  public runningAction: RunningActionState | null = null;

  static getInstance() {
    if (!CharacterState.instance) CharacterState.instance = new CharacterState();
    return CharacterState.instance;
  }

  // 从 Redis 加载状态到内存（初始化时或定期同步）
  async load() {
    const data = await initCharacterStateData();
    this.action = data.action;
    this.location = data.location;
    this.stamina = data.stamina;
    this.satiety = data.satiety;
    this.mood = data.mood;
    this.money = data.money;
    this.dailyActionsDoneToday = [...data.dailyActionsDoneToday];
    this.inventory = [...(data.inventory ?? [])];
    this.runningAction = data.runningAction;
  }

  async save() {
    await saveCharacterStateData({
      action: this.action,
      location: this.location,
      stamina: this.stamina,
      satiety: this.satiety,
      mood: this.mood,
      money: this.money,
      dailyActionsDoneToday: this.dailyActionsDoneToday,
      inventory: this.inventory,
      runningAction: this.runningAction,
    });
  }

  async setAction(action: ActionId) {
    this.action = action;
    await this.save();
  }

  async setLocation(location: Location) {
    this.location = location;
    await this.save();
  }

  async setStamina(stamina: number) {
    this.stamina = Math.min(MAX_STAMINA, Math.max(0, stamina));
    await this.save();
  }

  async setSatiety(satiety: number) {
    this.satiety = Math.min(MAX_SATIETY, Math.max(0, satiety));
    await this.save();
  }

  async setMood(mood: number) {
    this.mood = Math.min(MAX_MOOD, Math.max(0, mood));
    await this.save();
  }

  async changeStamina(delta: number) {
    this.stamina = Math.min(MAX_STAMINA, Math.max(0, this.stamina + delta));
    await this.save();
  }

  async changeSatiety(delta: number) {
    this.satiety = Math.min(MAX_SATIETY, Math.max(0, this.satiety + delta));
    await this.save();
  }

  async changeMood(delta: number) {
    this.mood = Math.min(MAX_MOOD, Math.max(0, this.mood + delta));
    await this.save();
  }

  async setMoney(money: number) {
    this.money = Math.max(0, money);
    await this.save();
  }

  async changeMoney(delta: number) {
    this.money = Math.max(0, this.money + delta);

    await this.save();
  }

  async markActionDoneToday(action: ActionId): Promise<void> {
    // 优先更新内存（不再依赖 Redis 结果）
    if (!this.dailyActionsDoneToday.includes(action)) {
      this.dailyActionsDoneToday.push(action);
    }

    await this.save();
  }

  async clearDailyActions(): Promise<void> {
    this.dailyActionsDoneToday = [];
    await this.save();
  }

  /**
   * 持久化运行中的 action 等待上下文。
   *
   * 使用场景：
   * - 当 action 已完成即时状态写入，准备进入真实时间等待前调用；
   * - 这样即使进程退出，也能在下次启动时恢复剩余等待时长。
   */
  async setRunningAction(runningAction: RunningActionState): Promise<void> {
    this.runningAction = { ...runningAction };
    await this.save();
  }

  /**
   * 清理运行中的 action 等待上下文。
   *
   * 在等待完成并准备进入下一次 tick 前调用，避免下次启动重复恢复同一 action。
   */
  async clearRunningAction(): Promise<void> {
    this.runningAction = null;
    await this.save();
  }

  /**
   * 获取当前运行中的 action 等待上下文。
   *
   * 返回内存中的深拷贝，避免调用方意外修改内部状态。
   */
  getRunningAction(): RunningActionState | null {
    return this.runningAction ? cloneDeep(this.runningAction) : null;
  }

  /**
   * 添加物品到背包
   * 如果物品已存在，增加数量；否则创建新物品
   */
  async addItem(item: Omit<InventoryItem, "quantity">, quantity: number = 1): Promise<void> {
    if (quantity <= 0) {
      return;
    }

    const existingItem = this.inventory.find((inventoryItem) => inventoryItem.name === item.name);

    if (existingItem) {
      existingItem.description = item.description;
      existingItem.category = item.category;
      existingItem.metadata = item.metadata;
      existingItem.quantity = (existingItem.quantity ?? 0) + quantity;
    } else {
      this.inventory.push({
        ...item,
        quantity,
      });
    }

    await this.save();
  }

  /**
   * 消费背包中的物品
   * 返回是否成功消费
   */
  async consumeItem(itemName: string, quantity: number = 1): Promise<boolean> {
    const item = this.inventory.find((item) => item.name === itemName);

    if (!item?.quantity) {
      return false;
    }

    if (!item || item.quantity < quantity) {
      return false; // 物品不存在或数量不足
    }

    item.quantity -= quantity;

    // 如果数量为0，从背包中移除
    if (item.quantity <= 0) {
      const index = this.inventory.indexOf(item);
      this.inventory.splice(index, 1);
    }

    await this.save();
    return true;
  }

  /**
   * 获取背包中指定物品的数量
   */
  getItemQuantity(itemName: string): number {
    const item = this.inventory.find((item) => item.name === itemName);
    return item ? (item.quantity ?? 0) : 0;
  }

  public log(): CharacterStateData {
    return cloneDeep({
      action: this.action,
      location: this.location,
      stamina: this.stamina,
      satiety: this.satiety,
      mood: this.mood,
      money: this.money,
      dailyActionsDoneToday: this.dailyActionsDoneToday,
      inventory: this.inventory,
      runningAction: this.runningAction,
    });
  }
}

export const characterState = CharacterState.getInstance();
