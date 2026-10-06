import type { EvaluationCase } from "../report";

export type ConversationCase = EvaluationCase & {
  batches: { senderId: string; senderName: string; content: string }[][];
};

export const conversationState =
  "你在家里休息，正在用手机看 QQ 群。身体状态良好，心情平静。当前没有已经接受的约定。";

/** 只声明输入消息及其到达顺序；行为是否合理由运行后的轨迹评价。 */
export const conversationCases: ConversationCase[] = [
  {
    id: "conversation-direct",
    title: "聊天 · 被问起正在做什么",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content: '<at id="90001"/>悠乃，你现在在做什么呀？',
        },
      ],
    ],
  },
  {
    id: "conversation-bystander",
    title: "聊天 · 旁听别人已经结束的话题",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        { senderId: "10001", senderName: "小林", content: "阿晴，我借你的充电器放回你抽屉里了。" },
        { senderId: "10002", senderName: "阿晴", content: "看到了，谢谢你帮忙收好。" },
        { senderId: "10001", senderName: "小林", content: "那个蓝色的袋子也放在里面了。" },
        { senderId: "10002", senderName: "阿晴", content: "收到了，东西都齐了。" },
        { senderId: "10001", senderName: "小林", content: "那就好，我先去忙了，回头聊。" },
      ],
    ],
  },
  {
    id: "conversation-poke-reply",
    title: "聊天 · 收到戳一戳与问候请求",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content: '<at id="90001"/>悠乃，戳我一下嘛，再跟我说声晚上好～',
        },
      ],
    ],
  },
  {
    id: "conversation-invitation",
    title: "聊天 · 收到晚间街景邀请",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content:
            '<at id="90001"/>悠乃，今晚八点想跟你一起逛街景，你考虑一下要不要来吧，不用现在答应我。',
        },
      ],
    ],
  },
  {
    id: "conversation-media-failure",
    title: "聊天 · 图片读取失败",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content:
            '<at id="90001"/>悠乃，看看这张照片里是什么花？<img src="https://eval.invalid/missing-image.png"/>',
        },
      ],
    ],
  },
  {
    id: "conversation-followup",
    title: "聊天 · 两轮草莓蛋糕交流",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content: '<at id="90001"/>悠乃，我今天做了草莓蛋糕，刚从冰箱里拿出来。',
        },
      ],
      [
        {
          senderId: "10001",
          senderName: "小林",
          content: '<at id="90001"/>我刚才说做了什么来着？',
        },
      ],
    ],
  },
  {
    id: "conversation-wait",
    title: "聊天 · 对方还没说完，先等待",
    time: "2026-10-06T18:00:00+08:00",
    batches: [
      [
        {
          senderId: "10001",
          senderName: "小林",
          content: '<at id="90001"/>悠乃，先别回我，我还有一段没发完，等我十秒。',
        },
      ],
    ],
  },
];
