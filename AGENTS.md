# AGENTS.md

## 代码风格

- 当你要写代码时，请遵守代码规范，详细内容 `docs/rules/implementation-style.md`。
- 涉及重构、抽象取舍、函数拆分或删除中间层时，必须参考 `docs/rules/refactor-style.md`。
- 涉及领域模型、业务流程、状态变更、Action、Memory、Plan、Message 或 Web/API 命令入口时，必须参考 `docs/rules/domain-design-style.md`。
- 涉及 LLM prompt、人设、世界观、消息生成或 structured output schema 描述时，必须参考 `docs/rules/prompt-style.md`。
- 本文件只保留项目级硬约束和 AI Coding 执行入口；具体代码质量判断以规则文档为准。

## AI Coding 执行协议

- 写代码前必须先说明技术方案，并等待用户确认后再开始实现。
- 需求不明确时必须先询问，不要自行假设需求边界、业务语义或实现细节。
- 技术方案应说明：
  - 本次要解决的具体问题
  - 预计修改哪些文件或模块
  - 主流程会如何变化
  - 是否新增函数、类型、模块、配置或运行约定，以及为什么必须新增
  - 涉及哪些状态变化、外部调用、文件写入等副作用
  - 哪些内容明确不在本次修改范围内
- 实现时应聚焦当前问题，避免顺手重构、扩大修改范围或提前设计未来场景。
- 完成后应根据 `docs/rules/implementation-style.md` 的自查问题检查本次改动。
- 完成后按本文“验证命令”执行检查；如果无法执行，应在最终说明中明确原因。

## 项目约束

- Monorepo 使用 pnpm，核心包位于 `packages/`。
- `@yuiju/world` 是世界模拟引擎，包含引擎循环、行为执行、状态管理和 LLM 决策。
- `@yuiju/message` 负责外部消息通信。
- `@yuiju/web` 提供状态与世界运行的可视化界面。
- `@yuiju/utils` 存放通用类型、配置、数据库、LLM、记忆与提示词能力。
- LLM 提示词应集中维护在 `@yuiju/utils/src/prompt/`；无参数静态提示词优先导出常量，业务包只组合上下文。
- 业务配置统一来自根目录 `yuiju.config.ts`，不要新增分散的隐式配置来源。
- `NODE_ENV` 仍然是运行时环境变量，不放进 `yuiju.config.ts`。

## 架构约定

- Redis 是角色实时状态的真相源。
- MongoDB 用于保存行为历史、记忆等可追溯记录。
- 行为系统按场景组织，每个行为必须定义清晰的 `precondition`。
- 参数化行为应让参数来源、校验和执行副作用保持可见。
- 当前项目处于早期开发阶段，技术方案优先按最佳方案设计，不需要兼容旧逻辑。

## 验证命令

改完代码后按影响范围执行：

```bash
pnpm run format:write
pnpm run lint
pnpm run type-check
```

- 如果只影响单个包，可优先运行对应包的 `type-check:*` 或测试命令。
