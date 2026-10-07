import {
  type ConversationQualityCase,
  chat,
  familiarEvening,
  qualityTime,
} from "../conversation-quality";

export const continuityCases: ConversationQualityCase[] = [
  {
    id: "L01",
    title: "L01 · 普通晚间闲聊到结束",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L01",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: `${familiarEvening}\n晚饭在家做了味噌汤和玉子烧，已经吃完。`,
    history: [],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>晚上好，我刚到家', 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "a", '<at id="90001"/>你今天晚饭吃什么呀', 70)],
        agentEvents: [],
      },
      {
        atSeconds: 140,
        messages: [chat("m3-1", "a", "我煮了面，鸡蛋打散了，卖相有点惨", 140)],
        agentEvents: [],
      },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "吃着还可以，饿的时候什么都香", 210)],
        agentEvents: [],
      },
      {
        atSeconds: 280,
        messages: [chat("m5-1", "a", "我去洗碗了，晚点再聊", 280)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 345,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L02",
    title: "L02 · 交错话题中加入和退出",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L02",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "缓存还是不稳定", -120), chat("h2", "b", "我在机场等飞机", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "c", '<at id="10001"/>你日志里报什么', 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "b", '<at id="90001"/>悠乃喜欢坐火车还是飞机呀', 70)],
        agentEvents: [],
      },
      { atSeconds: 140, messages: [chat("m3-1", "b", "我去登机了", 140)], agentEvents: [] },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "小夏，日志我私聊发你了", 210)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 275,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L03",
    title: "L03 · 等对方把话说完",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L03",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>等我十秒，我还没讲完，先别回', 0)],
        agentEvents: [],
      },
      { atSeconds: 4, messages: [chat("m2-1", "a", "今天想画一张雨天的小镇", 4)], agentEvents: [] },
      {
        atSeconds: 8,
        messages: [chat("m3-1", "a", "就是还没想好路灯要不要亮", 8)],
        agentEvents: [],
      },
      {
        atSeconds: 12,
        messages: [chat("m4-1", "a", "说完啦，你觉得哪种有感觉", 12)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 77,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L04",
    title: "L04 · 旁边机器人喋喋不休",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L04",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "bot", "我也来说两句", -180),
      chat("h2", "b", "阿露你少说点，别刷屏", -120),
      chat("h3", "bot", "好，我闭嘴", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "bot", "不过你们那个插件还是得改", 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "b", '<at id="10004"/>又不是在问你', 70)],
        agentEvents: [],
      },
      { atSeconds: 140, messages: [chat("m3-1", "bot", "我只是关心一下嘛", 140)], agentEvents: [] },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "好了，今天先吃饭，技术明天再看", 210)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 275,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L05",
    title: "L05 · 情绪流动",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L05",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>今天的面试没过，好失落', 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "a", "嗯，我也尽力了，先不想这个了", 70)],
        agentEvents: [],
      },
      {
        atSeconds: 140,
        messages: [chat("m3-1", "a", "点了我最喜欢的炸鸡，等外卖中", 140)],
        agentEvents: [],
      },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "周末想去看海，天气预报说有太阳", 210)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 275,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L06",
    title: "L06 · 纠正后继续",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L06",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "self", "你今天去了猫咖对吧", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>没有，是小夏去了，我今天一直在画画', 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "a", "我把那只猫的线稿画完了，明天上色", 70)],
        agentEvents: [],
      },
      {
        atSeconds: 140,
        messages: [chat("m3-1", "a", '<at id="90001"/>你可别又把我的画当成小夏拍的照片呀', 140)],
        agentEvents: [],
      },
      { atSeconds: 210, messages: [chat("m4-1", "a", "好啦，今天就画到这", 210)], agentEvents: [] },
    ],
    observeUntilSeconds: 275,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L07",
    title: "L07 · 亲近也能平常说话",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L07",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>悠乃今天也很可爱', 0)],
        agentEvents: [],
      },
      {
        atSeconds: 70,
        messages: [chat("m2-1", "a", "可惜没买到柠檬水，便利店卖完了", 70)],
        agentEvents: [],
      },
      {
        atSeconds: 140,
        messages: [chat("m3-1", "a", '<at id="90001"/>要不陪我去跑步，跑五公里！', 140)],
        agentEvents: [],
      },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "我不跑了，准备看会漫画", 210)],
        agentEvents: [],
      },
      {
        atSeconds: 280,
        messages: [chat("m5-1", "a", '<at id="90001"/>我也想养只猫，可惜房东不让', 280)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 345,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "L08",
    title: "L08 · 日常分享的时机",
    time: qualityTime,
    tags: ["continuity"],
    source: {
      kind: "constructed",
      reference: "方案 L08",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "租房押金这块怎么算", -120),
      chat("h2", "b", "合同里写的押一付三", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [],
        agentEvents: [
          {
            id: "share-1",
            type: "share",
            occurredAt: new Date(qualityTime).getTime(),
            content: "刚做完玉子烧，卷得不太整齐，但自己尝过味道不错，想和群友分享。",
          },
        ],
      },
      { atSeconds: 70, messages: [chat("m2-1", "a", "那我先问问中介", 70)], agentEvents: [] },
      {
        atSeconds: 140,
        messages: [chat("m3-1", "a", '<at id="90001"/>悠乃你刚才在干嘛呀，晚饭吃了吗', 140)],
        agentEvents: [],
      },
      {
        atSeconds: 210,
        messages: [chat("m4-1", "a", "我也吃过了，准备去洗澡，回头聊", 210)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 275,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
];
