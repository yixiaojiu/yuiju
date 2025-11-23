# 行为树（BT）+ LLM 策略层 技术方案

## 目标与原则
- 目标：让数字伙伴在无外部指令下按“世界观”自主决策（睡觉、起床、去学校等），并由 LLM 作为首选行为策略提供者产生候选行为与评分。
- 原则：最小实现与可审计；LLM 负责策略输出，BT 负责硬约束与仲裁；例行规则作为回退路径；所有行动遵守世界观硬约束。
- 技术栈：NodeJS + TypeScript；一分钟级 tick；可测试、可扩展。

## 架构总览
- `TickScheduler`：统一时间源与分钟级 tick（默认UTC+8）。
- `WorldState`：地点、活动、能量、设备、记忆（最近睡眠/到校时间）。
- `Blackboard`：行为树上下文与跨节点数据（含策略缓存与冷却记录）。
- `BehaviorTree`：根节点为`Selector`，组织主/次行为；节点返回`success/failure/running`。
- `Guards/Decorators`：硬约束（世界观不变式）与软约束评分（时间窗/作息偏好）装饰器。
- `ActionExecutor`：执行行动并更新`WorldState`与记忆；处理持续行动开始/结束。
- `EventBus`：发布`state.changed`、`action.started/ended`、`external.message`等事件。
- `LLMPolicyProvider`：在允许时机生成候选行为与分数/理由；内置速率限制与缓存；与`SafetyFilter`配合做硬过滤。
- 世界观映射：读取或静态引用`packages/source/prompt/world-view.ts:2`中的地点与限制，形成`constraints`（仅家/学校、不可跨越现实等）。

## 行为树设计
- 根`Selector`（优先级从高到低）：
  - `EmergencyBranch`：紧急/外部打断，优先级最高。
  - `LLMDrivenBranch`：由 LLM 产出候选行为；经硬约束过滤与软约束评分仲裁后执行。
  - `RoutineFallback`：确定性例行分支（睡觉/起床/去学校），在 LLM 无合适候选或被拒时回退。
- 典型节点组合：
  - `LLMDrivenBranch`：`Decorator(HardGuards, Action(LLMPolicy))`，返回候选集与分数；应用冷却与惰性避免抖动。
  - `RoutineFallback.Sleep`：`Sequence(IsNightSoft, AtHome, NotSleeping, StartSleeping)` → `Action(Sleep)`（软约束评分，允许被 LLM 超越）。
  - `RoutineFallback.Wake`：`Sequence(IsMorningSoft, IsSleeping, WakeUp)`。
  - `RoutineFallback.School`：`Sequence(IsWeekdaySoft, InWindow(07:20–07:40)Soft, AtHome, NotSleeping, GoToSchool)` → `Action(StudyAtSchool)`。

## LLM 策略层
- 触发时机：在非不可中断的主行动期间与空闲窗口；支持显式“可抢占”候选用于打断（需更高分与硬约束通过）。
- 输入：`WorldState`、`Blackboard`、世界观摘要（地点限制、设备能力）、当前时间与最近记忆。
- 输出：若干`CandidateAction`（type、理由、建议分数、是否可抢占），由`SafetyFilter`与硬守卫过滤后进入候选池。
- 安全策略：
  - 硬约束过滤：地点只能`home/school`；禁止跨越现实；不可用设备的行为拒绝；与长持续行动冲突时仅允许可抢占候选。
  - 速率限制与缓存：在同一时间窗内至多请求一次；重复建议去重；失败原因缓存避免短期内重试。
  - 可解释性：保留`rationale`用于日志与调试；最终决策由本地仲裁完成。

## 决策流程（每分钟）
- 拉取当前时间与`WorldState`；触发行为树`tick`。
- `EmergencyBranch`优先处理打断事件（如外部消息）。
- `LLMDrivenBranch`获取策略候选（命中缓存则跳过请求），应用硬过滤与软约束评分；结合冷却/惰性计算总分。
- 若无合适候选或分数低于阈值，进入`RoutineFallback`按例行规则执行。
- 执行动作，更新状态与记忆，发布事件与日志。

## 数据模型（接口轮廓）
- `WorldState`: `location: 'home' | 'school'`, `activity: 'idle' | 'sleeping' | 'studying' | 'commuting'`, `energy: number`, `devices: { phone: { hasNewInfo: boolean } }`, `memory: { lastSleepStart?: Date; lastWake?: Date; lastArriveSchool?: Date }`。
- `Action`: `{ type: string; payload?: any; effects(state): WorldState; duration?: { start?: Date; end?: Date } }`。
- `Node`: `{ tick(ctx): 'success' | 'failure' | 'running' }`；`Decorator(node, guard)`包装条件。
- `CandidateAction`: `{ action: Action; score: number; source: 'rule' | 'llm'; rationale?: string; preemptive?: boolean }`。
- `SoftConstraint`: `{ name: string; weight: number; score(state, time, action): number }`（越高越符合偏好）。
- `CoolingPolicy`: `{ key: string; ttlMs: number }`（为同类行为设置冷却）。

## 约束与规则
- 硬约束：地点仅`家/学校`；不可主动观察现实；设备能力仅手机接收信息；未开放地点与能力一律拒绝。
- 软约束：时间窗（睡眠`22:30–06:30`、工作日出发`07:20–07:40`）、作息倾向、习惯加权；以`SoftConstraint`评分体现，可被高分候选覆盖。
- 冲突仲裁：长持续行动（睡眠/上课）默认保留控制权；仅允许标记`preemptive`的候选打断，且需显著更高总分。
- 抖动抑制：行为冷却与惰性（对当前行动加权），避免频繁切换。

## 配置与日志/测试
- 配置：时区、时间窗、节假日（可选）；LLM速率与超时；软约束权重；冷却策略。
- 日志：记录每次决策路径、评分明细、过滤原因、最终行动、LLM候选与被拒绝原因。
- 测试：
  - 单元测试：硬守卫、软约束评分、冷却与惰性、节点返回值与边界时间。
  - 场景测试：周末/工作日切换、打断与恢复、LLM候选不足时的回退。

## 最小落地步骤
- 定义`WorldState`、`Action`、`Node`、装饰器与基础分支（紧急/LLM/例行）。
- 实现`TickScheduler`与`ActionExecutor`，打通状态更新与事件。
- 接入`LLMPolicyProvider`与`SafetyFilter`，实现候选获取、硬过滤与软约束评分；加入冷却与惰性。
- 编写例行规则的回退逻辑（睡觉/起床/去学校）；添加基础日志与2–3个场景测试。

## 扩展方向
- 增加校园内活动（图书馆、自习），由LLM在空闲选择；
- 外部事件驱动（手机消息）作为紧急/优先分支；
- 个性化参数（睡眠倾向、通勤耗时）影响分数与窗口形状。
