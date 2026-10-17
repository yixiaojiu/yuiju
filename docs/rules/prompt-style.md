# Prompt 规范

## 目标

约束 LLM prompt、人设描述、消息生成和 structured output schema 的写法，避免视角混乱、工程概念外泄和提示词分散。

## 视角

- 直接任务指令、输出说明、决策要求和 schema 描述优先使用第二人称“你”。
- 第三人称“悠酱/她”只用于稳定世界观、人设背景、角色事实说明，不用于直接要求模型执行的任务指令。
- 同一个 prompt 中，任务指令和 schema 字段描述应保持同一视角。
- 不要在同一段要求里混用“你”“我”“悠酱”表达同一个决策主体。

## 人设与任务

- 人设背景说明角色是谁、生活节奏、偏好和边界。
- 任务指令说明这次要模型做什么、如何判断、输出什么。
- 不要把人设背景写成隐含业务规则；影响决策的约束要在任务要求里明确表达。
- 涉及角色扮演时，优先让模型代入“你正在做决策/你正在生成消息”，而不是旁观描述角色。

## 工程概念

- 面向外部用户或群聊的消息生成 prompt，不要要求模型提到 Action、completionEvent、内部接口、触发记录、schema、字段名等工程概念。
- 工程事实可以作为上下文输入，但最终消息必须转成自然生活表达。
- 如果 prompt 需要基于内部事实判断，应说明“不要重新判断已完成的上游决策”，只判断当前任务负责的边界。

## 维护位置

- 通用默认提示词集中维护在 `packages/shared/src/prompt/`，按业务模块分目录；角色专属提示词放在 `data/prompt/${key}.txt` 或 `${key}.md`，正文为纯文本，仅加载这两种扩展名的文件。
- prompt key 保留点号分组，各段使用下划线命名，例如 `agent_loop.main`、`character.initial_cognition.yuuno`；TS 函数和变量仍使用驼峰。
- 代码内的每个提示词导出包含唯一 `key`、默认 `template` 和可选 `description` 的常量；模板变量使用 `{{variableName}}`。
- 内置提示词在 `definitions.ts` 中显式汇集；应用及 eval 入口在启动业务前调用 `initializePrompts()`。先加载默认模板，再读取 data 文件：去掉扩展名得到 key，同 key 覆盖正文并保留 description，新 key 直接注册；同 key 同时存在两种扩展名、文件读取失败时直接报错。
- 业务只通过 `renderPrompt(key, variables)` 渲染内存模板，不访问文件；修改文件后重启生效。
- 业务包只组合上下文和调用 LLM，不在业务流程里散写大段 prompt。
- 修改 prompt 时同步检查 structured output schema 的 `describe` 文案，避免视角或语义不一致。
