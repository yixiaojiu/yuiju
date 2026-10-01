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
- 项目规范优先于 AI 的通用工程习惯；当二者冲突时，必须以项目规范为第一优先级。
- 任何情况都不要新增防御性逻辑、兼容逻辑、默认兜底或宽松 fallback；发现输入不满足预期时，优先回到上游修正契约，不要在当前层补偿。
- 数据库设计破坏性变更时需要提醒我
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

- Monorepo 使用 pnpm，应用位于 `apps/`，公共技术能力位于 `packages/shared/`。
- `apps/character-runtime` 负责角色大脑、聊天、场景 loop、情绪、计划与记忆。
- `apps/world-simulator` 负责世界运转、实际状态、行动执行和事件推送，不负责角色的 LLM 决策。
- `apps/dashboard` 使用 Next.js，提供管理界面及 Hono API，API 统一使用 Node.js runtime。
- `packages/shared` 放实际共用的技术能力与集中维护的提示词定义，不放大脑、聊天、记忆等业务执行逻辑。
- 旧应用与旧包保留作参考，新功能在新架构中实现，不要求兼容旧逻辑。
- 项目内部模块使用能够直接定位声明文件的具体路径导入，不通过包根入口或 barrel index 聚合导入。
- 提示词定义集中维护在 `packages/shared/src/prompt/`，按业务模块分目录，导出包含 `key`、`template` 和可选 `description` 的常量；通过 `definitions.ts` 汇集，由模板系统首次渲染时自动注册，业务只通过 key 渲染。

## 验证命令

改完代码后按影响范围执行：

```bash
pnpm run format:write
pnpm run lint
pnpm run type-check
```

- 如果只影响单个包，可优先运行对应包的 `type-check:*` 或测试命令。
