# 技术架构

Yuiju 的核心不是收到消息后临时生成一段回复，而是让角色在持续运行的世界里生活。角色先经历事件、形成状态和记忆，再通过消息系统把这些经历表达出来。

## 整体结构

![Yuiju 整体架构](/development/images/architecture.png)

| 模块 | 负责什么 |
| --- | --- |
| `@yuiju/world` | 推进时间、环境和角色行为 |
| `@yuiju/message` | 接收外部消息，组织上下文并发送回复 |
| `@yuiju/dashboard` | 新版管理界面，展示角色、世界状态、活动、记忆和日志 |
| `@yuiju/utils` | 提供配置、存储、模型、Prompt 和记忆能力 |
| `@yuiju/satorijs-adapter-onebot` | 将 OneBot 消息转换为统一消息格式 |

旧 Web 已删除，Dashboard 位于 `apps/dashboard`，通过 Hono API 读取新系统数据。下文保留旧版 World、Message 与记忆架构的说明。

## World 如何运行

World 同时推进世界环境和角色行为。两条流程共享状态，但各自负责不同事实。

### 世界状态推进

![世界状态推进流程](/development/images/world-state-flow.svg)

世界状态推进维护时间、天气、场景开放状态和资源数量。每一轮会读取当前状态与外部命令，依次执行 Evolution，最后把新状态写回 Redis。

这条流程持续运行，不依赖用户是否正在聊天。

### 角色行为推进

![角色行为推进流程](/development/images/character-state-flow.svg)

角色行为推进按以下顺序工作：

1. 读取角色状态、世界状态和历史经历。
2. 使用每个 Action 的 `precondition` 过滤当前可执行行为。
3. 让 LLM 从候选 Action 中选择，并给出原因和必要参数。
4. 由 Action executor 执行状态变化。
5. 保存行为记录，供记忆、日记和消息回复使用。

LLM 只负责选择，不直接修改状态。

### Action

Action 是角色行为的最小执行单元。它把一段生活行为变成可以判断、执行和记录的明确步骤。

```ts
{
  action: ActionId.Go_To_School_From_Home,
  description: "从家前往学校。[体力-7][饱腹-5][耗时20分钟]",
  precondition(context) {
    return isAtHome(context) && isWeekday(context) && isMorning(context);
  },
  async executor(context) {
    await context.characterState.setLocation(School);
    await context.characterState.changeStamina(-7);
    await context.characterState.changeSatiety(-5);
  },
  durationMin: 20,
}
```

- `description` 告诉 LLM 这个行为会发生什么。
- `precondition` 决定行为能否进入候选列表。
- `executor` 执行真实副作用。
- `durationMin` 决定下一轮角色行为何时开始。

## Message 如何处理对话

![消息系统流程](/development/images/message-flow.svg)

OneBot、飞书等平台先通过 Satori adapter 转成统一消息事件。Message 再完成消息标准化、白名单判断、上下文读取、LLM 回复和历史写入。

群聊和私聊分别维护上下文。上下文由三部分组成：

- 最近的原始消息，用于理解当前对话。
- 较早消息的滚动摘要，用于控制上下文长度。
- 已沉淀的 Memory Episode，用于保留值得长期记住的经历。

同一群聊连续收到新消息时，旧的回复生成会被取消，避免过期回复晚于新消息发出。

## 记忆如何形成

![记忆模块流程](/development/images/memory-flow.svg)

`MemoryEpisode` 保存已经发生的经历，是可追溯事实。日记和人物记忆根据 Episode 或对话窗口生成，是对事实的整理，不替代原始记录。

可选的 Python / Graphiti 服务负责长期记忆图谱写入和语义检索。它只处理 TypeScript 业务流程已经确认的 Episode，不决定事件是否真实发生。

## 数据放在哪里

- Redis 是角色和世界实时状态的真相源。
- MongoDB 保存行为历史、消息、Memory Episode 和日记。
- `yuiju.config.json` 是业务配置的统一入口。

修改模型调用或 Prompt 前，请继续阅读 [LLM 协定](./llm-contract)；接入数据库和外部服务时，请阅读[外部依赖](./dependencies)。
