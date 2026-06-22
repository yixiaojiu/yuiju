# LLM 协定

本文说明项目中 LLM 能做什么、不能做什么，以及 Prompt 和 structured output schema 的维护边界。

## 总原则

LLM 是决策和文本生成能力，不是状态真相源。

- LLM 可以基于当前上下文选择 Action、生成消息、整理日记、总结记忆。
- LLM 不直接修改 Redis、MongoDB、文件或外部平台状态。
- 所有状态变化必须由业务流程或 Action executor 显式执行。
- 所有可追溯事实必须落到 `MemoryEpisode`、行为记录、消息记录或明确的状态字段中。

## Prompt 维护位置

Prompt 文案集中维护在 `@yuiju/utils/src/prompt/`。

- 无参数静态 Prompt 优先导出常量。
- 业务包只组合上下文、选择模型并调用 LLM。
- `@yuiju/source` 只保留图片、音频、数据集和辅助脚本资源，不再作为 Prompt 真相源。
- 修改 Prompt 时，需要同步检查 structured output schema 的字段说明，避免视角和语义不一致。

Prompt 写法遵守 [Prompt 规范](./rules/prompt-style.md)。

## World 决策边界

`@yuiju/world` 中，LLM 负责在候选 Action 中做选择。

主流程边界：

1. World/Character 状态和历史记录由代码读取。
2. Action 的 `precondition` 由代码过滤可执行候选。
3. LLM 只能从候选 Action 中选择，并给出原因、参数和计划变化建议。
4. Action executor 执行真实副作用，例如更新角色状态、消耗资源、写入行为记录。
5. 是否写入记忆、日记或主动分享，由后续业务流程显式处理。

LLM 不应判断未进入候选列表的 Action，也不应绕过 `precondition` 直接声明角色已经做了某事。

## Message 生成边界

`@yuiju/message` 中，LLM 负责生成自然语言回复。

- 私聊和群聊入口先完成平台消息标准化、白名单判断和上下文构造。
- 面向外部用户的回复不能暴露 Action、schema、字段名、completion event 等工程概念。
- 群聊中新消息替换旧请求时，应让旧 LLM 调用停止或抛出取消错误，不继续发送过期回复。
- 表情包只能通过 `message.stickers` 中声明的稳定 key 引用。

消息是否发送、发送到哪个平台、是否写回历史，由消息 handler 和平台 adapter 显式控制。

## Memory 与 Diary 边界

- `MemoryEpisode` 是经历事实记录，用于保存可追溯事件。
- `Diary` 是基于 Episode 生成的叙事归档，不替代 Episode 真相源。
- Graphiti/Python 服务只承接长期记忆图谱写入和检索，不负责决定业务事件是否真实发生。
- 用户记忆、计划记忆和图谱记忆的写入时机由 TS 侧业务流程决定。

## 模型来源

模型来源统一来自根目录 `yuiju.config.ts` 的 `llm.models`：

- `chat`：对话类模型。
- `strong`：复杂决策和长链路推理。
- `flash`：快速轻文本任务。
- `vision`：图片理解。

每类模型可以配置多个 OpenAI-compatible source。调用失败时，`@yuiju/utils/src/llm/models.ts` 会按顺序尝试备用来源，并对失败来源做短时间冷却。

## 禁止事项

- 不要在业务包里散写大段 Prompt。
- 不要让 LLM 直接决定 Redis/MongoDB/文件/外部平台写入。
- 不要把临时日志、调试信息或 UI 展示状态写成长期记忆事实。
- 不要让最终用户可见消息包含内部字段名、schema 或工程流程。
- 不要为了“更智能”绕过 Action precondition、白名单、权限或配置边界。
