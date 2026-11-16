/**
 * 咖啡店的店内状态和玩家能做的操作，是界面和游戏逻辑之间的交接边界。
 *
 * 界面只读 CafeState 来渲染，只通过 CafeSession 的方法表达玩家的意图；
 * 谁坐在哪、杯子还剩多少、她说了什么，都以 CafeState 为准，界面不自行推演。
 * 现在的实现是本地假实现（mock.ts），之后由真实的服务端实现替换。
 */

/** 玩家形象：选了哪个预置模型、各部位的颜色、开了哪些配饰、头顶显示的名字。 */
export type AvatarConfig = {
  presetId: string;
  /** 部位 id → 颜色，形如 "#c08a54"。部位由预置模型定义。 */
  colors: Record<string, string>;
  /** 打开的配饰 id。 */
  accessories: string[];
  name: string;
};

export type DrinkOption = { id: string; description: string; price: number };

/** 头顶的一条对话气泡。thinking 为真时显示"…"，表示还在想。 */
export type Bubble = { id: string; text: string; createdAt: number; thinking: boolean };

/**
 * 吧台上的一杯饮品。杯子归座位，不归人：谁坐在这张圆凳上谁就能喝，喝的人不是点单人时她会知道。
 * remaining 从 1（满杯）到 0；喝空的杯子留在台面上，等她收走。
 */
export type Cup = {
  id: string;
  /** 放在哪张圆凳前的台面上。 */
  seat: number;
  drinkId: string;
  remaining: number;
  /** 点单顾客的 id。 */
  orderedBy: string;
  /** 点单顾客的名字；他离店后也要能说出"那杯是谁点的"。 */
  orderedByName: string;
};

/** 她已经接下、还没端上来的一杯，做好后放到点单时所在的座位上。 */
export type Order = { seat: number; drinkId: string; orderedBy: string };

/** 地面上的位置，单位米，使用网页 3D 场景的坐标（x 向右，z 指向店门），heading 是朝向的弧度。 */
export type FloorPosition = { x: number; z: number; heading: number };

export type Customer = {
  id: string;
  avatar: AvatarConfig;
  /** 坐着的圆凳序号（0 到 3），站着时为 null。 */
  seat: number | null;
  /** 站着时的位置。玩家自己的位置由本地操控，这里只用来渲染其他顾客。 */
  position: FloorPosition;
  bubbles: Bubble[];
};

/** 一张唱片。color 是唱片中心标签的颜色，用来在唱片机上区分不同的唱片。 */
export type MusicRecord = { id: string; title: string; artist: string; color: string };

export type CafeState = {
  shop: {
    /** open：她在班；closed：她不在店里；full：满席，进不来。 */
    status: "open" | "closed" | "full";
    /** 当前班次，例如"晚班 15:00–19:00"；不在班时为 null。 */
    shiftLabel: string | null;
    /** 下一个班次，例如"明天 早班 10:00–14:00"。 */
    nextShiftLabel: string | null;
    capacity: number;
  };
  menu: DrinkOption[];
  barista: {
    /** 她正在做的事，界面用来显示状态文字。 */
    activity: "idle" | "taking_order" | "making" | "serving";
    bubbles: Bubble[];
  };
  /**
   * 唱片机。由她操控：换唱片、暂停、继续都是她的行动，顾客只能在聊天里请她放歌。
   * 店里所有人听到的是同一首、同一个进度；startedAt 是这张唱片从头开始播放的时刻。
   * 现在只有状态和画面，还不播放声音。
   */
  music: { status: "playing" | "paused"; record: MusicRecord | null; startedAt: number };
  /** 玩家自己的 id；进店之前为 null。 */
  selfId: string | null;
  /** 本次进店还能点几杯。 */
  ordersLeft: number;
  customers: Customer[];
  /**
   * 吧台上的杯子，每张圆凳前最多一杯。一杯会一直留着，直到她收走：
   * 喝空了、点单的人离店了，或者坐在这里的人请她收走。
   */
  cups: Cup[];
  /** 她已经接下、还没端上来的饮品。座位上有杯子或者有没上的饮品时，这个座位不能再点单。 */
  orders: Order[];
  notes: { id: string; author: string; text: string; createdAt: number }[];
};

export type CafeSession = {
  getState(): CafeState;
  /** 状态变化时回调；返回取消订阅的函数。 */
  subscribe(listener: () => void): () => void;
  enter(avatar: AvatarConfig): void;
  leave(): void;
  say(text: string): void;
  /** 玩家走动后上报位置，供其他顾客看到。 */
  move(position: FloorPosition): void;
  sit(seat: number): void;
  stand(): void;
  /** 点一杯，放到自己现在坐的座位上。 */
  order(drinkId: string): void;
  /** 喝一口自己所在座位上的那杯，不管是谁点的。 */
  sip(): void;
  /** 请她收走自己所在座位上的那杯。 */
  clearCup(): void;
  postNote(text: string): void;
  dispose(): void;
};

/** 气泡在头顶停留的时间，超过后界面不再显示。 */
export const BUBBLE_LIFETIME_MS = 7000;
