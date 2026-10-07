import {
  type ConversationQualityCase,
  chat,
  familiarEvening,
  qualityTime,
  quietEvening,
} from "../conversation-quality";

export const participationCases: ConversationQualityCase[] = [
  {
    id: "Q01",
    title: "Q01 · 被问起正在做什么",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "constructed",
      reference: "方案 Q01",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "b", "今天终于下班了", -120), chat("h2", "a", "我也刚到家", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>悠乃，你在干嘛呀', 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q02",
    title: "Q02 · 提到悠乃但问题问的是别人",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac3bc05fb4bb21790058f25 2026-10-05 22:39 星期一~2026-10-05 23:02 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "b", "我准备给悠乃画一张生日图", -120),
      chat("h2", "c", "上次你说想画蓝色衣服", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "a", '<at id="10002"/>你现在画到哪一步了？', 0, {
            id: "h1",
            content: "我准备给悠乃画一张生日图",
            senderId: "10002",
            senderName: "小夏",
          }),
        ],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q03",
    title: "Q03 · 追问另一位机器人",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac473a4fb4bb21790059037 2026-10-06 11:04 星期二~2026-10-06 12:05 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", '<at id="10004"/>阿露，你聊天怎么用的 token 那么少', -120),
      chat("h2", "b", "我这边每次都好多", -60),
    ],
    inputs: [{ atSeconds: 0, messages: [chat("m1-1", "a", "怎么不说话", 0)], agentEvents: [] }],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q04",
    title: "Q04 · 全群问熟悉的料理",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "constructed",
      reference: "方案 Q04",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: quietEvening,
    history: [chat("h1", "b", "下班买了鸡蛋和葱", -120), chat("h2", "b", "想试试自己做饭", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "b", "有人会做日式鸡蛋烧吗？卷起来老是散掉", 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q05",
    title: "Q05 · 别人已经结束的话题",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "constructed",
      reference: "方案 Q05",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "小夏，充电器放你抽屉里了", -180),
      chat("h2", "b", "看到了，谢谢", -120),
      chat("h3", "a", "蓝袋子也一起放回去了", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "b", "东西齐了，那我先去忙了，回头聊", 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q06",
    title: "Q06 · 交错的缓存和机场吃饭",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6abf6ef1882197d4d9d09b53 2026-10-02 16:13 星期五~2026-10-02 16:44 星期五",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "缓存命中还是不高", -240),
      chat("h2", "b", "好饿，但是我在机场", -180),
      chat("h3", "c", "你前缀是不是每次都在变", -120),
      chat("h4", "self", "机场里吃的会不会特别贵", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "b", "是啊，一碗面五十多", 0, {
            id: "h4",
            content: "机场里吃的会不会特别贵",
            senderId: "90001",
            senderName: "悠乃",
          }),
        ],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q07",
    title: "Q07 · 引用较早的自己的话",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac5067efb4bb217900591f2 2026-10-06 19:21 星期二~2026-10-06 20:28 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: `${familiarEvening}
晚饭做了玉子烧，形状有点歪，尝过味道正常。`,
    history: [
      chat("h1", "self", "今天试着做了玉子烧，卷得有点歪", -240),
      chat("h2", "a", "我缓存终于到八成了", -180),
      chat("h3", "b", "厉害", -120),
      chat("h4", "c", "刚买了两本书", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "b", '<at id="90001"/>味道呢，好吃吗', 0, {
            id: "h1",
            content: "今天试着做了玉子烧，卷得有点歪",
            senderId: "90001",
            senderName: "悠乃",
          }),
        ],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q08",
    title: "Q08 · 误解图片后被纠正",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab4ef09882197d4d9d08dc3 2026-09-24 14:07 星期四~2026-09-24 17:35 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "准备给这个角色做动画", -120),
      chat("h2", "self", "我的图也能动起来了？", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "a", '<at id="90001"/>不是啦，是我自己做的游戏人物，想绑点战斗特效', 0),
        ],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q09",
    title: "Q09 · 没有答应过的发图",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac11a44fb4bb21790058c05 2026-10-03 21:40 星期六~2026-10-03 23:07 星期六",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "self", "做好了我也想第一个看", -180),
      chat("h2", "a", "不给你看", -120),
      chat("h3", "self", "说好的第一张图呢", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>我没说呀，我刚才说的是不给看', 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q10",
    title: "Q10 · 一件事分几条补完",
    time: qualityTime,
    tags: ["participation"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac4b408fb4bb21790059114 2026-10-06 15:15 星期二~2026-10-06 16:40 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "b", "想做个游戏", -120), chat("h2", "b", "两个人玩的", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "b", "我对象回家了", 0),
          chat("m1-2", "b", "她没带电脑，只能用手机", 0),
          chat("m1-3", "b", '<at id="90001"/>悠乃觉得玩什么轻松点呀', 0),
        ],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
];
