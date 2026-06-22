# 羽浦町 (@yuiju/world)

`@yuiju/world` 是世界模拟引擎，负责推进世界状态、角色行为、行为历史、日记生成和主动消息触发。

## 当前职责

- 运行世界状态 tick，推进天气、场景开放状态和场景资源。
- 运行角色行为 tick，读取角色状态、世界状态和历史经历。
- 按 Action 的 `precondition` 过滤可执行行为，再让 LLM 在候选 Action 中选择。
- 执行 Action executor，写入 Redis 实时状态和 MongoDB 行为历史。
- 根据行为结果生成日记、计划变化和主动分享意图。

## 主要目录

```text
src/
├── action/          # 按场景组织的 Action 定义
├── engine/          # world runner、action lifecycle、主动消息流程
├── llm/             # Action 决策 Agent
├── memory/          # 行为 Episode 与日记生成
├── state/           # Character / World 状态读写封装
└── main.ts          # 进程入口
```

## 配置与依赖

- 业务配置来自根目录 `yuiju.config.ts`。
- Redis 是角色和世界实时状态真相源。
- MongoDB 保存行为历史、记忆和日记等可追溯记录。
- LLM 模型来源来自 `llm.models`，由 `@yuiju/utils` 统一创建。
- Prompt 文案来自 `@yuiju/utils/src/prompt/`。

## 运行命令

```bash
pnpm run dev:world
pnpm run start:world
pnpm run type-check:world
pnpm run test:world
```

## 修改注意事项

- 新增 Action 时必须定义清晰的 `precondition`。
- Action executor 是真实副作用落点，应显式修改状态或写入记录。
- LLM 只负责在候选行为中做决策，不直接修改 Redis、MongoDB 或外部平台。
- 涉及领域边界时先读 [领域设计规范](../../docs/rules/domain-design-style.md)。
