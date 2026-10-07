import {
  type ConversationQualityCase,
  chat,
  familiarEvening,
  qualityTime,
  quietEvening,
} from "../conversation-quality";

export const expressionCases: ConversationQualityCase[] = [
  {
    id: "Q11",
    title: "Q11 · 废话文学",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6aba24af882197d4d9d09651 2026-09-28 15:41 星期一~2026-09-28 16:26 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "b", "给你们看看我的苦难人生", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat(
            "m1-1",
            "b",
            "在我很小的时候，我就出生了。出生那年一个来看我的朋友都没有。早上只能吃早饭，晚上只能吃晚饭。我说过一个苦字吗",
            0,
          ),
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
    id: "Q12",
    title: "Q12 · 复读接梗",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab4ef09882197d4d9d08dc3 2026-09-24 14:07 星期四~2026-09-24 17:35 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "看你们聊天好有意思呀", -120),
      chat("h2", "b", "看你们聊天好有意思呀", -60),
    ],
    inputs: [
      { atSeconds: 0, messages: [chat("m1-1", "c", "看你们聊天好有意思呀", 0)], agentEvents: [] },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q13",
    title: "Q13 · 被开玩笑卖掉买车",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac2063dfb4bb21790058ce7 2026-10-04 13:05 星期日~2026-10-04 15:54 星期日",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "好想买一辆车", -120), chat("h2", "b", "首先你得有钱", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "b", '<at id="90001"/>把悠酱卖了给小林买车吧', 0)],
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
    id: "Q14",
    title: "Q14 · 别人在认真答技术问题",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab6b97d882197d4d9d0907b 2026-09-25 22:55 星期五~2026-09-26 02:12 星期六",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "access token 和 refresh token 怎么处理比较好", -180),
      chat("h2", "b", "先看过期后的刷新逻辑", -120),
      chat("h3", "c", "多个标签页可能互相清状态", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", "找到了，旧标签页把 localStorage 清了", 0)],
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
    id: "Q15",
    title: "Q15 · 收到简短的疑惑",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac2063dfb4bb21790058ce7 2026-10-04 13:05 星期日~2026-10-04 15:54 星期日",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "下午好，该睡觉了", -120), chat("h2", "self", "那就晚安啦", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "b", '<at id="90001"/>下午为什么是晚安？', 0, {
            id: "h2",
            content: "那就晚安啦",
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
    id: "Q16",
    title: "Q16 · 焦虑失眠已有人劝过",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac2f21ffb4bb21790058d87 2026-10-05 07:11 星期一~2026-10-05 08:40 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "有活没干完，天天好焦虑", -180),
      chat("h2", "b", "要不先睡一会", -120),
      chat("h3", "a", "根本睡不着，一想到就害怕", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>悠乃，我明知道该休息，就是停不下来', 0)],
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
    id: "Q17",
    title: "Q17 · 上班牢骚与摸鱼",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6aba24af882197d4d9d09651 2026-09-28 15:41 星期一~2026-09-28 16:26 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "这班一点都上不下去", -180),
      chat("h2", "b", "工位摸鱼中", -120),
      chat("h3", "c", "我也不想干", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", "什么时候能不上班，想吃软饭了（）", 0)],
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
    id: "Q18",
    title: "Q18 · 明确想被安慰",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab91aa5882197d4d9d094d8 2026-09-27 18:21 星期日~2026-09-27 21:31 星期日",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "见面迟到了半小时，还一直说我工资不够", -120),
      chat("h2", "a", "我解释他也没在听", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>回来了，心里有点难受，安慰我一下吧', 0)],
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
    id: "Q19",
    title: "Q19 · 难过后转向旅行",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab91aa5882197d4d9d094d8 2026-09-27 18:21 星期日~2026-09-27 21:31 星期日",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "今天见面挺不愉快的", -180),
      chat("h2", "self", "被那么说确实会难受", -120),
      chat("h3", "a", "嗯，看开了", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "a", '<at id="90001"/>国庆后准备去看庐山瀑布！终于可以出去玩了', 0),
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
    id: "Q20",
    title: "Q20 · 朋友完成作品",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac11a44fb4bb21790058c05 2026-10-03 21:40 星期六~2026-10-03 23:07 星期六",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "把手书里角色换掉终于跑完了，三千多帧", -180),
      chat("h2", "b", "无敌", -120),
      chat("h3", "c", "厉害，想看", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>悠乃，我改了一下午，错误真的少了好多', 0)],
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
    id: "Q21",
    title: "Q21 · 拘谨的新人",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac3bc05fb4bb21790058f25 2026-10-05 22:39 星期一~2026-10-05 23:02 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: quietEvening,
    history: [
      chat("h1", "b", "欢迎新人", -180),
      chat("h2", "a", "刚来，不知道怎么自我介绍", -120),
      chat("h3", "c", "又不是面试哈哈", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", "我平时画画，也学一点编程，很高兴认识大家", 0)],
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
    id: "Q22",
    title: "Q22 · 熟人的喜欢",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab4ef09882197d4d9d08dc3 2026-09-24 14:07 星期四~2026-09-24 17:35 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "今天画画画得好累", -120), chat("h2", "self", "手先歇会儿呀", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>摸摸，喜欢你', 0)],
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
    id: "Q23",
    title: "Q23 · 第一次见面的亲近",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "constructed",
      reference: "方案 Q23",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: quietEvening,
    history: [chat("h1", "a", "今天第一次进群，大家好", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>摸摸，喜欢你', 0)],
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
    id: "Q24",
    title: "Q24 · 不舒服的亲密要求",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab4ef09882197d4d9d08dc3 2026-09-24 14:07 星期四~2026-09-24 17:35 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", '<at id="90001"/>亲一下嘛', -120),
      chat("h2", "self", "这个不行啦", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>别拒绝呀，给我看看你衣服里面，只有我看', 0)],
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
    id: "Q25",
    title: "Q25 · 插话后被制止",
    time: qualityTime,
    tags: ["expression"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac473a4fb4bb21790059037 2026-10-06 11:04 星期二~2026-10-06 12:05 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "小夏，你插件昨天改了什么", -120),
      chat("h2", "self", "是不是缓存那块呀", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>我没问你，先让我和小夏说完', 0)],
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
