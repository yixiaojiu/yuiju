import type { AvatarConfig, Bubble, CafeSession, CafeState, Cup, Customer } from "./state";

/**
 * 本地假实现：不连服务端，用固定的台词和定时器模拟她的反应，只用来开发和检查界面。
 * 真实实现需要提供同样的 CafeSession，并由服务端和她的 agent 驱动 CafeState。
 */

const MENU = [
  { id: "深煎拼配", description: "深煎豆香扎实，苦韵干净，适合慢慢喝。", price: 35 },
  { id: "浅煎拼配", description: "浅煎风味明亮，带一点果香，尾韵轻盈。", price: 38 },
  { id: "冰滴咖啡", description: "低温慢萃，口感清透，冰凉里带着回甘。", price: 42 },
  { id: "美式", description: "清爽直接，苦感利落，是最经典的一杯。", price: 36 },
  { id: "牛奶咖啡", description: "热牛奶把咖啡的苦味收得柔和，温暖又顺口。", price: 45 },
  { id: "维也纳咖啡", description: "浓咖啡顶着柔软鲜奶油，入口香甜，余味还是咖啡香。", price: 55 },
];

const REPLIES = [
  "嗯嗯，我在听哦～",
  "诶，真的吗？",
  "今天店里很安静呢。",
  "要不要尝尝今天的手冲？",
  "哈哈，你说话好有意思。",
];

const RECORDS = [
  { id: "record-1", title: "雨の喫茶店", artist: "薄暮トリオ", color: "#c8955a" },
  { id: "record-2", title: "午後のワルツ", artist: "Kanata Quartet", color: "#8fae8b" },
  { id: "record-3", title: "珈琲と古本", artist: "Shiori", color: "#c97b6b" },
  { id: "record-4", title: "夜更けのピアノ", artist: "Mitsuki Ito", color: "#7d8fb8" },
];
/** 假实现里一张唱片放多久后她会换下一张。 */
const RECORD_LENGTH_MS = 150_000;
/** 聊天里出现这些字时，她会当作顾客在请她放歌。 */
const MUSIC_WORDS = ["歌", "音乐", "唱片", "曲子"];

const ORDERS_PER_VISIT = 3;
const SIP_AMOUNT = 0.25;
/** 杯子喝空后，她过多久来收走。 */
const CLEAR_EMPTY_CUP_MS = 2500;

function bubble(text: string, thinking = false): Bubble {
  return { id: crypto.randomUUID(), text, createdAt: Date.now(), thinking };
}

export function createMockSession(): CafeSession {
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // 喝过的别人点的杯子，她只对每杯说一次。
  const remarkedCups = new Set<string>();
  // 一位固定坐在最里面圆凳上的顾客，用来检查多人在场时的界面。
  const regular: Customer = {
    id: "mock-regular",
    avatar: {
      presetId: "yuuno",
      colors: { hair: "#5b4636", top: "#6f8a6a", skirt: "#ffffff" },
      accessories: [],
      name: "常客小林",
    },
    seat: 2,
    position: { x: 0, z: 0, heading: 0 },
    bubbles: [],
  };
  let state: CafeState = {
    shop: {
      status: "open",
      shiftLabel: "晚班 15:00–19:00",
      nextShiftLabel: "明天 早班 10:00–14:00",
      capacity: 4,
    },
    menu: MENU,
    barista: { activity: "idle", bubbles: [] },
    music: { status: "playing", record: RECORDS[0], startedAt: Date.now() },
    selfId: null,
    ordersLeft: ORDERS_PER_VISIT,
    customers: [regular],
    cups: [
      {
        id: "cup-regular",
        seat: 2,
        drinkId: "美式",
        remaining: 0.6,
        orderedBy: regular.id,
        orderedByName: regular.avatar.name,
      },
      // 一位已经离店的客人没喝完的咖啡，用来检查"喝别人点的饮品"。
      {
        id: "cup-departed",
        seat: 1,
        drinkId: "牛奶咖啡",
        remaining: 0.5,
        orderedBy: "mock-departed",
        orderedByName: "早上来的客人",
      },
    ],
    orders: [],
    notes: [
      {
        id: "note-1",
        author: "常客小林",
        text: "上周的维也纳咖啡超好喝！",
        createdAt: Date.now() - 86_400_000,
      },
      {
        id: "note-2",
        author: "一位匿名客人",
        text: "店里的音乐是什么歌呀？",
        createdAt: Date.now() - 3_600_000,
      },
    ],
  };

  function update(change: (current: CafeState) => CafeState) {
    state = change(state);
    for (const listener of listeners) {
      listener();
    }
  }

  function later(delayMs: number, run: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, delayMs);
    timers.add(timer);
  }

  function updateSelf(change: (self: Customer) => Customer) {
    update((current) => ({
      ...current,
      customers: current.customers.map((customer) =>
        customer.id === current.selfId ? change(customer) : customer,
      ),
    }));
  }

  /** 她先显示思考气泡，过一会儿换成真正的回复。 */
  function baristaReply(text: string) {
    const thinking = bubble("…", true);
    update((current) => ({
      ...current,
      barista: { ...current.barista, bubbles: [...current.barista.bubbles, thinking] },
    }));
    later(1500, () =>
      update((current) => ({
        ...current,
        barista: {
          ...current.barista,
          bubbles: [
            ...current.barista.bubbles.filter((item) => item.id !== thinking.id),
            bubble(text),
          ],
        },
      })),
    );
  }

  /** 她把某张圆凳前的杯子收走。 */
  function removeCup(seat: number) {
    update((current) => ({ ...current, cups: current.cups.filter((cup) => cup.seat !== seat) }));
  }

  /** 她按接单顺序一杯一杯地做，做好放到点单时所在的座位上。 */
  function serveNextOrder() {
    if (state.orders.length === 0 || state.barista.activity !== "idle") {
      return;
    }
    const order = state.orders[0];
    update((current) => ({ ...current, barista: { ...current.barista, activity: "making" } }));
    baristaReply(`好的，一杯${order.drinkId}，请稍等～`);
    later(6000, () => {
      const orderer = state.customers.find((customer) => customer.id === order.orderedBy)!;
      const cup: Cup = {
        id: crypto.randomUUID(),
        seat: order.seat,
        drinkId: order.drinkId,
        remaining: 1,
        orderedBy: order.orderedBy,
        orderedByName: orderer.avatar.name,
      };
      update((current) => ({
        ...current,
        orders: current.orders.slice(1),
        cups: [...current.cups, cup],
        barista: { ...current.barista, activity: "serving" },
      }));
      baristaReply(`久等啦，您的${order.drinkId}。`);
      later(3000, () => {
        update((current) => ({ ...current, barista: { ...current.barista, activity: "idle" } }));
        serveNextOrder();
      });
    });
  }

  // 常客隔一阵子说一句话。
  /** 她把唱片换成下一张。 */
  function playNextRecord() {
    update((current) => {
      const index = RECORDS.findIndex((record) => record.id === current.music.record!.id);
      return {
        ...current,
        music: {
          status: "playing",
          record: RECORDS[(index + 1) % RECORDS.length],
          startedAt: Date.now(),
        },
      };
    });
  }

  // 一张唱片放完，她换下一张。
  const recordTimer = setInterval(() => {
    playNextRecord();
    baristaReply("换一张唱片吧～");
  }, RECORD_LENGTH_MS);

  const regularTalk = setInterval(() => {
    update((current) => ({
      ...current,
      customers: current.customers.map((customer) =>
        customer.id === regular.id
          ? { ...customer, bubbles: [...customer.bubbles, bubble("这杯美式今天特别香。")] }
          : customer,
      ),
    }));
  }, 25_000);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enter(avatar: AvatarConfig) {
      const self: Customer = {
        id: crypto.randomUUID(),
        avatar,
        seat: null,
        position: { x: 0, z: 0, heading: 0 },
        bubbles: [],
      };
      update((current) => ({
        ...current,
        selfId: self.id,
        ordersLeft: ORDERS_PER_VISIT,
        customers: [...current.customers, self],
      }));
      baristaReply(`欢迎光临！${avatar.name}，随便坐吧～`);
    },
    leave() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      // 她收走离店的人点的杯子；喝空的杯子本来就在等她收，定时器清掉了，也一并收走。
      update((current) => ({
        ...current,
        selfId: null,
        customers: current.customers.filter((customer) => customer.id !== current.selfId),
        cups: current.cups.filter((cup) => cup.orderedBy !== current.selfId && cup.remaining > 0),
        orders: current.orders.filter((order) => order.orderedBy !== current.selfId),
        barista: { activity: "idle", bubbles: [] },
      }));
    },
    say(text) {
      updateSelf((self) => ({ ...self, bubbles: [...self.bubbles, bubble(text)] }));
      if (MUSIC_WORDS.some((word) => text.includes(word))) {
        baristaReply("好呀，我去换一张唱片。");
        later(2500, playNextRecord);
        return;
      }
      baristaReply(REPLIES[Math.floor(Math.random() * REPLIES.length)]);
    },
    move(position) {
      updateSelf((self) => ({ ...self, position }));
    },
    sit(seat) {
      updateSelf((self) => ({ ...self, seat }));
    },
    stand() {
      updateSelf((self) => ({ ...self, seat: null }));
    },
    order(drinkId) {
      const self = state.customers.find((customer) => customer.id === state.selfId)!;
      update((current) => ({
        ...current,
        ordersLeft: current.ordersLeft - 1,
        orders: [...current.orders, { seat: self.seat!, drinkId, orderedBy: self.id }],
      }));
      serveNextOrder();
    },
    sip() {
      const self = state.customers.find((customer) => customer.id === state.selfId)!;
      const cup = state.cups.find((current) => current.seat === self.seat)!;
      const remaining = Math.max(cup.remaining - SIP_AMOUNT, 0);
      update((current) => ({
        ...current,
        cups: current.cups.map((item) => (item.id === cup.id ? { ...item, remaining } : item)),
      }));
      if (cup.orderedBy !== self.id && !remarkedCups.has(cup.id)) {
        remarkedCups.add(cup.id);
        baristaReply(`诶……那杯是${cup.orderedByName}点的哦。`);
      } else if (remaining === 0) {
        baristaReply("喝完啦？味道还可以吗？");
      }
      if (remaining === 0) {
        later(CLEAR_EMPTY_CUP_MS, () => removeCup(cup.seat));
      }
    },
    clearCup() {
      const self = state.customers.find((customer) => customer.id === state.selfId)!;
      baristaReply("好的，我来收走～");
      removeCup(self.seat!);
    },
    postNote(text) {
      const self = state.customers.find((customer) => customer.id === state.selfId)!;
      update((current) => ({
        ...current,
        notes: [
          ...current.notes,
          { id: crypto.randomUUID(), author: self.avatar.name, text, createdAt: Date.now() },
        ],
      }));
    },
    dispose() {
      clearInterval(regularTalk);
      clearInterval(recordTimer);
      for (const timer of timers) {
        clearTimeout(timer);
      }
      listeners.clear();
    },
  };
}
