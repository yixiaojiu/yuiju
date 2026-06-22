# 公共能力包 (@yuiju/utils)

`@yuiju/utils` 是跨包公共能力层，提供配置、类型、Redis、MongoDB、LLM、Memory、Prompt 和常量。

## 当前职责

- 读取根目录 `yuiju.config.ts`。
- 定义 Character、World、Action、Plan、Memory 等领域类型。
- 提供 Redis 客户端和状态读写封装。
- 提供 MongoDB 连接、schema 和读写操作。
- 创建 OpenAI-compatible LLM 模型来源。
- 维护 Prompt 文案和 Prompt 工具。
- 提供记忆、日记、人物记忆和计划相关公共能力。

## 主要目录

```text
src/
├── config/      # yuiju.config.ts 类型与读取器
├── constants/   # 角色和世界静态常量
├── db/          # MongoDB 连接、schema、operations
├── llm/         # 模型来源、工具调用、structured output
├── memory/      # Episode、Diary、Person Memory、Plan Memory
├── prompt/      # Prompt 真相源
├── redis/       # Redis 客户端与状态读写
├── types/       # 领域类型
└── time.ts      # 项目时区相关工具
```

## 配置边界

- 业务配置只从根目录 `yuiju.config.ts` 读取。
- `NODE_ENV` 仍是运行时环境变量，不进入 `yuiju.config.ts`。
- `env.ts` 只保留 `isDev` / `isProd` 这类运行模式判断，不负责加载配置文件。
- 不要在业务包里新增分散配置读取逻辑。

## 运行命令

```bash
pnpm run type-check:utils
```

## 修改注意事项

- 新增公共能力前确认它确实跨包复用，且不把业务规则藏进 utils。
- Prompt 修改遵守 [Prompt 规范](../../docs/rules/prompt-style.md)。
- Redis / MongoDB 副作用应让调用方能看清状态来源和写入目的。
