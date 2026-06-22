# 技术方案

## 目标

本次要解决的问题不是给现有 `WorldState` 补几个字段，而是把“世界演进”设计成一个独立模块。

当前项目里，角色行为 loop 会推进角色状态，weather 又是单独实现的一条旁路逻辑，但世界本身还没有形成统一的运行时模型。这会导致：

- 世界状态缺乏统一真相源语义，当前只有时间和天气，场景状态与资源状态没有正式位置。
- 世界演进和角色行为 loop 耦合过近，不适合作为 `@yuiju/message`、`@yuiju/web` 等其他模块的公共依赖。
- 运行时推进和进程重启后的恢复逻辑没有统一模型，后续很难继续扩展更多世界规则。

本次设计目标是：

- 将世界演进定义为独立模块，不依赖角色行为 loop。
- 世界时间与真实时间同步。
- 运行时按固定 tick 推进世界。
- 进程重启后不逐 tick 补帧，而是直接把世界状态追平到当前真实时间。
- weather、场景开放状态、场景资源刷新统一纳入世界演进模型。
- 采用 `WorldRunner` + 领域演进类组织世界演进流程，不使用函数式流水线，也不采用 ECS 建模。
- 状态读写复用现有 `worldState` 类，不新增独立的世界状态读写 class。

## 核心结论

世界演进采用“固定 tick 运行 + 按时间差恢复”的模型：

- 在线运行时，世界引擎按固定 tick 持续推进。
- 世界时间与真实时间同步，但恢复时不按停机时长逐 tick 回放。
- 进程重启后，世界状态直接从“上次推进时间”收敛到“当前真实时间”。
- 各领域演进类用代码逻辑计算状态变化，不通过固定规则表或 ECS 组件系统驱动。

这意味着固定 tick 是运行时调度模型，不是恢复时的历史回放模型。

## 模块边界

世界演进只需要两类 class：

### 1. WorldRunner

`WorldRunner` 是世界演进的运行入口，职责类似当前角色行为 loop 的 runner。

它负责：

- 启动时恢复世界状态到当前真实时间。
- 启动固定 tick 循环。
- 停止固定 tick 循环。
- 在每个 tick 中编排一次完整世界推进。
- 读取和保存现有 `worldState`。
- 应用外部世界命令。
- 按固定顺序调用各领域演进类。

`WorldRunner` 承担世界推进主流程，但不把天气、场景、资源等具体业务判断写在自己内部。具体状态如何变化，交给领域演进类。

### 2. 领域演进类

领域演进类负责具体世界事实的推进，例如：

- `WeatherEvolution`
- `SceneEvolution`
- `ResourceEvolution`

这些类统一继承抽象基类 `WorldEvolution`，只暴露一个 `advance()` 推进入口。

抽象类定义如下：

```ts
abstract class WorldEvolution {
  abstract precondition(context: WorldAdvanceContext): boolean | Promise<boolean>;
  abstract advance(context: WorldAdvanceContext): Promise<WorldStateData>;
}
```

这些类承载自定义代码逻辑。它们可以根据时间差、当前世界状态、外部命令、天气、场景状态等上下文计算下一状态。

现有 `worldState` 类仍然是 Redis 世界状态读写入口。它不作为本次新增 class 设计的一部分，也不负责决定天气怎么变、场景是否开放、资源怎么刷新。

## WorldStateData 设计

### 1. lastAdvancedAt

- `lastAdvancedAt`
  - 这份世界状态最后一次被推进到的真实时间。

这里最关键的是 `lastAdvancedAt`。恢复时所有领域演进类都依赖它来判断需要追平的时间差。

### 2. weather

`weather` 是世界状态的一部分，不再作为旁路特例存在。建议保留：

- 当前天气快照。
- 当前天气阶段开始时间。
- 当前天气阶段结束时间。
- 上次更新时间。

天气如何变化由 `WeatherEvolution` 的代码逻辑决定，将之前的 weather 逻辑迁移过来。

### 3. scenes

`scenes` 表达场景当前动态事实。场景自己的资源状态也放在对应场景内部，不再在顶层单独拆 `resources`。

例如：

- 学校当前是否开放。
- 商店当前是否开放。
- 咖啡店当前是否开放。
- 公园当前可采集资源数量。
- 海岸当前可采集资源数量。

这里保存的是“当前事实”。至于学校、商店、咖啡店如何判断开放，由 `SceneEvolution` 根据时间、天气、命令、当前世界状态和未来新增上下文计算。

场景内资源状态必须保存“当前剩余量”，因为它不仅由时间决定，还会受角色行为或其他外部输入影响。资源如何刷新或消耗由 `ResourceEvolution` 和世界命令处理逻辑决定。

## 类职责设计

### WorldRunner

`WorldRunner` 管理运行时节奏，也编排一次完整世界推进：

- `start()`
  - 加载世界状态。
  - 调用自身恢复流程，把世界追平到当前真实时间。
  - 启动固定 tick。
- `stop()`
  - 停止固定 tick。
- `runTick()`
  - 读取当前世界状态。
  - 构造统一的 `WorldAdvanceContext`。
  - 应用本轮世界命令。
  - 按固定顺序调用领域演进类。
  - 保存新的世界状态。

它不应该承载天气、场景、资源等具体业务判断。

`WorldRunner` 的一次推进主流程建议保持固定顺序：

1. 读取当前 `WorldStateData`。
2. 根据 `lastAdvancedAt` 和当前真实时间构造 `WorldAdvanceContext`。
3. 读取并应用本轮世界命令。
4. 按显式数组顺序检查每个 `WorldEvolution.precondition()`。
5. 对满足条件的领域演进类调用 `WorldEvolution.advance()`。
6. 更新 `lastAdvancedAt`。
7. 保存新的 `WorldStateData`。

这个类可以理解为世界版本的 runner + lifecycle 合并体。当前世界演进流程还比较聚焦，先不额外拆一个只做编排的 `WorldEvolution` class。

### WeatherEvolution

`WeatherEvolution` 负责推进天气状态。

它可以根据：

- 当前时间。
- 上次天气阶段。
- 当前季节或未来扩展的世界上下文。
- 已有天气状态。

计算下一份天气状态。

### SceneEvolution

`SceneEvolution` 负责推进场景动态状态。

它可以根据：

- 当前时间。
- 当前天气。
- 场景当前状态。
- 外部命令。

计算学校、商店、咖啡店、公园等场景的开放状态或其他动态状态。

这里使用代码逻辑表达业务规则，不把场景开放规则写成固定配置表。

### ResourceEvolution

`ResourceEvolution` 负责推进场景内部的资源状态。

它可以根据：

- 当前时间差。
- 当前天气。
- 当前场景状态。
- 资源当前剩余量。
- 上次刷新或消耗时间。
- 外部命令。

计算资源刷新、恢复、消耗后的状态。

## 状态推进模型

世界推进的统一语义是：

- 输入：旧 `WorldStateData`、`fromTime`、`toTime`、外部命令。
- 输出：新 `WorldStateData`。

同一套推进语义同时服务两种场景：

### 1. 在线运行时

`fromTime -> toTime` 是一个较小的 tick 间隔。`WorldRunner` 按固定频率执行一次世界推进。

### 2. 启动恢复时

`fromTime -> toTime` 可能是几分钟、几小时，甚至更久。恢复时不逐 tick 回放，而是让 `WorldRunner` 调用各领域演进类直接根据时间差把世界状态收敛到目标时刻。

因此，固定 tick 只是运行时调度方式，不是世界状态唯一的推进方式。

## Tick 主流程

世界引擎在线运行时，每次 tick 建议遵循同一条执行顺序：

1. `WorldRunner` 触发 tick。
2. `WorldRunner` 通过现有 `worldState` 读取当前 `WorldStateData`。
3. `WorldRunner` 构造统一的 `WorldAdvanceContext`。
4. `WorldRunner` 应用本轮世界命令。
5. `WorldRunner` 按固定顺序调用领域演进类。
6. `WorldRunner` 通过现有 `worldState` 保存新状态。

其中最重要的约束是：一次推进中的所有领域演进类共享同一个 `WorldAdvanceContext`，不能各自读取系统时间各算各的。否则同一轮推进内部会出现时间不一致。

`WorldAdvanceContext` 至少应包含：

- 当前真实时间。
- 上次推进时间。
- 本次时间差 `delta`。
- 本轮待处理的外部输入命令。

## 启动恢复模型

世界时间与真实时间同步，但进程停机时不逐 tick 补帧。

启动恢复时的模型应为：

1. `WorldRunner` 启动。
2. `WorldRunner` 通过现有 `worldState` 读取旧 `WorldStateData`。
3. 获取当前真实时间 `now`。
4. 从 `lastAdvancedAt` 直接推进到 `now`。
5. 写回追平后的世界状态。
6. `WorldRunner` 再进入固定 tick 运行。

这样即使停机时间很长，也不会因为补大量 tick 导致启动卡顿。

## 外部输入与世界变更

既然世界演进是独立模块，其他模块不应直接改写 `WorldStateData` 的内部字段。更合理的方式是让外部通过统一的世界命令影响世界。

例如：

- 角色行为消耗某个资源。
- 某个场景被临时关闭。

世界命令由 `WorldRunner` 在一次推进主流程中统一读取和应用，再交给对应领域演进类继续计算。这样世界状态的变更入口是统一的，角色 loop、message、web 不会绕过世界模块直接修改真相源。

## 当前场景下的设计约束

结合当前需求，第一阶段至少需要覆盖：

- weather 作为世界状态的一部分，由 `WeatherEvolution` 推进。
- 学校、商店、咖啡店等场景状态，由 `SceneEvolution` 推进。
- 公园、水音池等场景内部资源状态，由 `ResourceEvolution` 推进。

这些状态都应进入统一的 `WorldStateData`，并通过统一的 tick 与恢复模型推进。

## 明确不在本次设计范围内

本次只讨论世界状态设计与状态推进模型，不展开以下内容：

- 具体代码接口签名。
- 物理目录拆分或是否拆新 package。
- Web 展示层如何消费更完整的世界状态。
- 所有场景一次性建模完成。
- 世界变化如何落库成最终 MemoryEpisode。

本次先把世界演进的架构边界、状态结构和推进模型定义清楚，后续实现与扩展都基于这套模型展开。
