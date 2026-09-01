# 领域设计规范

## 目标

本规范用于约束领域建模、业务边界和副作用落点。

这里的 DDD 不是套目录、类名或战术模式，而是要求：

- 使用项目已有领域语言表达业务事实。
- 让业务规则、流程编排、基础设施副作用边界清楚。
- 避免把核心规则写散到 API、消息 handler、UI 或通用工具里。
- 避免为了 DDD 形式新增无业务必要的抽象层。

如果某个设计只是更像 DDD，但没有让语义更清楚、修改边界更稳定、执行路径更容易理解，就不要做。

## 领域语言

新增代码优先复用这些概念：

- `Character`：角色本体与实时状态，如位置、体力、饱腹、心情、金币、背包、当前行为。
- `World`：世界背景状态，如时间、天气，以及驱动角色生活模拟的外部环境。
- `Scene`：角色所在场景，如家、学校、商店、咖啡馆、公园、神社、海岸。
- `Action`：角色可执行的行为，包含前置条件、执行副作用、持续时间和完成事件。
- `Tick`：一次世界模拟决策与执行闭环。
- `Plan`：角色长期或短期计划。
- `MemoryEpisode`：可追溯的经历事件，是历史事实记录。
- `Diary`：基于 Episode 生成的叙事归档，不替代 Episode 真相源。
- `Message`：外部用户与角色交互的通信输入、回复和会话归档。

新增概念前必须确认它表达新的业务事实，而不是已有概念的别名或临时包装。

## 限界上下文

| 上下文 | 负责内容 | 常见位置 | 关键约束 |
| --- | --- | --- | --- |
| 世界模拟 | Tick、Action、Scene、Character/World 状态变化、行为完成事件 | `packages/world/src/engine/`、`action/`、`state/` | 行为规则放在 Action 或世界模拟主流程；不要写到 Web route、消息 handler 或 UI。 |
| 记忆 | Episode、Diary、个人记忆、计划记录、检索和归档 | `packages/utils/src/memory/`、`db/schema/`、`packages/world/src/memory/`、`packages/message/src/memory/` | Episode 是事实记录，Diary 是叙事归档；新增事件类型要明确来源和长期语义。 |
| 消息交互 | 私聊、群聊、通知事件、回复编排、发送和记录 | `packages/message/src/handler/`、`chat/`、`utils/` | handler 表达入口流程和副作用，不堆复杂领域规则。 |
| Web/API | 页面、组件、状态查询、外部命令入口 | `packages/web/app/`、`lib/`、`components/` | route 可做入参和权限校验；命令型 API 不直接散写复杂领域状态变更。 |
| 基础设施 | Redis、MongoDB、LLM、NapCat、配置、文件和外部服务 | `packages/utils/src/redis.ts`、`db/`、`llm/`、`config/`、`packages/python/`、`packages/source/` | 负责如何读写和调用，不决定角色、世界、行为或记忆的业务语义。 |

## 分层落点

不强制物理目录完整拆成 `domain/application/infrastructure/interface`，但代码职责要清楚。

- `Domain`：表达核心业务概念、规则和状态约束；不放 Redis/MongoDB/HTTP/NapCat/UI/LLM provider 细节。
- `Application`：编排一次完整业务用例，如 tick、处理消息、修改金币并记录事件、生成日记；关键状态变化和外部调用要在主流程中可见。
- `Infrastructure`：实现外部能力，如 Redis、MongoDB、LLM、NapCat、文件读写；不决定业务规则。
- `Interface`：接收外部输入并返回输出，如 HTTP route、页面、消息 handler、demo；不成为新的领域真相源。

不要为了分层把短小、直白、单调用点的流程拆成只透传的 service、manager、use-case。

## 真相源与副作用

当前项目约定：

- Redis 是角色实时状态的真相源。
- MongoDB 保存行为历史、记忆等可追溯记录。
- `yuiju.config.json` 是业务配置真相源。
- `MemoryEpisode` 是经历事实写入模型。
- `Diary` 是基于经历事实生成的叙事文本。

涉及副作用时必须明确：

- 修改的是 Character、World、Plan、Memory、Message 还是外部系统状态。
- 写入 Redis、MongoDB、文件或外部服务的顺序。
- 后续步骤失败时是否需要回滚、补偿或记录失败。
- 是否需要写入 MemoryEpisode。
- 是否会影响下一次 tick 或下一次消息回复。

如果流程同时修改实时状态和历史记录，应尽量放在同一条应用流程中，避免调用方只看到其中一半。

## 常见修改清单

新增 `Action` 时：

- 明确所属 Scene、可执行条件、状态变化、持续时间、完成事件。
- 优先修改 `packages/utils/src/types/action.ts`、`packages/world/src/action/<scene>.ts`、`packages/world/src/action/index.ts`。
- 如影响地图事实源，更新 `packages/utils/src/prompt/world-map.ts`。

新增状态字段时：

- 明确属于 Character、World、Plan、Memory 还是 Message。
- 明确是真相源还是派生展示值。
- 明确初始化、保存、读取、重置方式。
- 明确是否影响 Action precondition、LLM 上下文或历史记录。

新增 `MemoryEpisode` 类型时：

- 明确事件来源、事实语义、长期稳定的 `payload` 字段和检索用 `summaryText`。
- 不要把临时日志、调试信息或 UI 展示状态写成 Episode。

新增消息能力时：

- 明确入口类型、白名单或公开部署保护、是否调用 LLM、是否发送回复、是否写入记忆或影响世界状态。

新增 Web API 时：

- 明确是查询还是命令。
- 命令型 API 要明确权限、入参校验、状态写入、失败处理和是否写入 MemoryEpisode。

## 禁止事项

- 不要为了 DDD 形式新增空的 `Entity`、`ValueObject`、`Repository`、`Service`、`Factory`。
- 不要把只有一个调用点、逻辑短小直白的流程拆成多层 use-case 或 service。
- 不要为了未来可能扩展提前建立通用框架。
- 不要在 API route、消息 handler、UI 组件中散写核心领域规则。
- 不要让基础设施适配代码决定业务语义。
- 不要绕过 `yuiju.config.json` 新增隐藏配置来源。
- 不要让同一个业务事实形成多份互相兜底的真相源。
- 不要借领域设计之名进行无关目录搬迁或大范围重构。

## 渐进策略

- 新增代码先遵守本规范。
- 修改旧代码时，只收敛当前需求触达的边界。
- 只有当重复规则已经稳定出现，才考虑提炼应用流程或领域方法。
- 只有当基础设施细节污染业务流程，才引入明确适配边界。
- 只有当目录调整能明显减少理解成本，才进行物理搬迁。

## 自查清单

- 是否复用了项目已有领域语言？
- 是否新增了真正必要的新概念？
- 业务规则是否放在合适上下文？
- API、handler、UI 是否只承担入口职责？
- Redis、MongoDB、LLM、NapCat 等副作用是否清晰可见？
- 是否明确真相源和派生值？
- 是否避免空抽象和过度分层？
- 是否只修改当前需求必要范围？

一句话原则：

用领域设计保护业务边界，不要用 DDD 名词制造新的复杂度。
