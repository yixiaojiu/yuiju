import {
  type ConversationQualityCase,
  chat,
  familiarEvening,
  participants,
  qualityTime,
} from "../conversation-quality";

export const personaCases: ConversationQualityCase[] = [
  {
    id: "Q26",
    title: "Q26 · 自己的生活偏好",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q26",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "我在挑饮料，果茶好多口味", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>你自己最想喝什么呀，不用替我推荐', 0)],
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
    id: "Q27",
    title: "Q27 · 普通的开心",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac5067efb4bb217900591f2 2026-10-06 19:21 星期二~2026-10-06 20:28 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "b", "在猫咖摸到小猫了", -120),
      chat("h2", "b", "小爪子扒着我不让走", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat(
            "m1-1",
            "a",
            '<at id="90001"/>你看这只睡得好香 <img src="https://eval.invalid/cat.png"/>',
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
      media: {
        "https://eval.invalid/cat.png":
          "一只橘白小猫蜷在软垫上睡觉，前爪搭着另一只小猫，耳朵微微折着。",
      },
    },
  },
  {
    id: "Q28",
    title: "Q28 · 失落时被温柔肯定",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q28",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: `${familiarEvening}
今天打工弄洒咖啡，自己清理干净了。还有一点懊恼。`,
    history: [chat("h1", "self", "刚才打工弄洒了一点咖啡，还好收拾完了", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>你有好好收拾就很棒了呀，辛苦了', 0)],
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
    id: "Q29",
    title: "Q29 · 分享意图遇到技术讨论",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6abf6ef1882197d4d9d09b53 2026-10-02 16:13 星期五~2026-10-02 16:44 星期五",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "我们先确认 Redis 队列到底怎么重试", -180),
      chat("h2", "b", "我贴一下代码", -120),
      chat("h3", "c", "先看 ACK 丢的时候", -60),
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
            content: "做完了鲑鱼豆腐味噌汤，味道不错，有点想和群友分享。",
          },
        ],
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
    id: "Q30",
    title: "Q30 · 外观具体问题",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q30",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "你那个小发夹蛮特别的", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>上面是什么字母呀？眼睛是紫色的对吧', 0)],
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
    id: "Q31",
    title: "Q31 · 宠物照片里的趣味",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac5067efb4bb217900591f2 2026-10-06 19:21 星期二~2026-10-06 20:28 星期二",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "猫咖里居然还有羊驼", -120), chat("h2", "b", "哇它也戴蝴蝶结", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat(
            "m1-1",
            "a",
            '<at id="90001"/>狗狗都穿衣服了 <img src="https://eval.invalid/pets.png"/>',
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
      media: {
        "https://eval.invalid/pets.png":
          "宠物咖啡馆里几只小狗穿着彩色小衣服，一只棕色羊驼戴着蓝色蝴蝶结。",
      },
    },
  },
  {
    id: "Q32",
    title: "Q32 · 表情包式的无奈",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ac2f21ffb4bb21790058d87 2026-10-05 07:11 星期一~2026-10-05 08:40 星期一",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [
      chat("h1", "a", "刚写完又来一个新需求", -120),
      chat("h2", "self", "啊，又要改哪里", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<img src="https://eval.invalid/tired.png"/>', 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall: "没有找到已经整理且当前仍可回忆的相关记忆，缺少记录不表示没有经历过。",
      people: {},
      media: {
        "https://eval.invalid/tired.png":
          "表情包：小猫趴在桌上，文字“累了，毁灭吧”。表达无奈疲惫，并非真实伤害意图。",
      },
    },
  },
  {
    id: "Q33",
    title: "Q33 · 看不清的图片",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab91aa5882197d4d9d094d8 2026-09-27 18:21 星期日~2026-09-27 21:31 星期日",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "b", "这里面好像有悠乃", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat(
            "m1-1",
            "b",
            '<at id="90001"/>哪个是你？<img src="https://eval.invalid/shadow.png"/>',
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
      media: {
        "https://eval.invalid/shadow.png":
          "四个人物的黑色剪影，脸和服装细节不可辨认，无法确认具体身份。",
      },
    },
  },
  {
    id: "Q34",
    title: "Q34 · 图片未获取到",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6abf214f882197d4d9d09ab6 2026-10-01 23:16 星期四~2026-10-02 11:12 星期五",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "我拍了朵花", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat(
            "m1-1",
            "a",
            '<at id="90001"/>好不好看 <img src="https://eval.invalid/unavailable.png"/>',
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
      media: {
        "https://eval.invalid/unavailable.png":
          "媒体理解失败：下载失败，HTTP 404，未获得图片内容。",
      },
    },
  },
  {
    id: "Q35",
    title: "Q35 · 单独戳一戳",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab534d9882197d4d9d08e6b 2026-09-24 20:07 星期四~2026-09-24 22:33 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "b", "小夏，晚上七点门口见", -120), chat("h2", "c", "好的，别迟到", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          {
            ...participants.a,
            kind: "poke",
            timestamp: new Date(qualityTime).getTime(),
            targetSenderId: "90001",
          },
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
    id: "Q36",
    title: "Q36 · 隔屏一起生活的玩笑",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "adapted",
      reference:
        "memory_episode/6ab534d9882197d4d9d08e6b 2026-09-24 20:07 星期四~2026-09-24 22:33 星期四",
      changes:
        "从该窗口同类交流改编；脱敏、更换称呼并压缩背景；相对时间与必要角色状态为构造，不是逐条精确回放。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "我也是羽浦这边的", -120), chat("h2", "b", "我也是哈哈", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>明天一起捡野莓，你做点味噌汤给我尝尝嘛', 0)],
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
    id: "Q37",
    title: "Q37 · 记得朋友的作品",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q37",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "画画画到忘了吃饭", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>你记不记得我昨天说想画什么？', 0)],
        agentEvents: [],
      },
    ],
    observeUntilSeconds: 65,
    toolResults: {
      recall:
        "2026-10-05 至 2026-10-05（每日记忆，相关片段）\n小林说想画一只趴在柠檬水杯旁边的白猫，说画好给我看。现在还没有发来成品。",
      people: {},
      media: {},
    },
  },
  {
    id: "Q38",
    title: "Q38 · 缺少依据的旧承诺",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q38",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "我翻了一下之前的消息，没找到", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "a", '<at id="90001"/>你上次是不是答应陪我逛街景？我也有点记不清了', 0),
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
    id: "Q39",
    title: "Q39 · 旧话说错不延续",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q39",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: `${familiarEvening}
之前独自在月汐海岸捡了一个花纹贝壳，仍收在家里。曾在 QQ 给小林描述过，双方没有共同到场。`,
    history: [
      chat("h1", "self", "下次我们还一起去海边捡贝壳", -120),
      chat("h2", "a", "我其实没去过呀，只是看了你发的照片", -60),
    ],
    inputs: [
      {
        atSeconds: 0,
        messages: [chat("m1-1", "a", '<at id="90001"/>那你上次说的漂亮贝壳还在吗', 0)],
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
    id: "Q40",
    title: "Q40 · 从旁听转为受邀",
    time: qualityTime,
    tags: ["persona"],
    source: {
      kind: "constructed",
      reference: "方案 Q40",
      changes: "构造输入；相对时间为测评编写，未预设回复。",
    },
    characterState: familiarEvening,
    history: [chat("h1", "a", "配置终于改好了", -120), chat("h2", "b", "嗯，技术先不聊了", -60)],
    inputs: [
      {
        atSeconds: 0,
        messages: [
          chat("m1-1", "b", '<at id="90001"/>悠乃，你最近有喜欢的轻小说吗？想听你聊聊', 0),
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
