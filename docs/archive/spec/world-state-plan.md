# 修改方案

## 目标

基于 `./world-state-design.md`，本次实现要把世界演进从当前角色行为 loop 和 weather 旁路 scheduler 中独立出来。

核心目标：

- 复用现有 `worldState` 类作为 Redis 世界状态读写入口。
- 新增 `WorldRunner`，负责世界演进的启动恢复、固定 tick 和一次推进主流程。
- 新增抽象基类 `WorldEvolution`，让各领域演进类继承同一契约。
- 将现有 weather 同步逻辑迁移到 `WeatherEvolution`。
- 新增 `SceneEvolution` 和 `ResourceEvolution` 的第一版结构。
- `resources` 不做顶层状态，放入对应 `scenes` 内部。
- 移除 `main.ts` 中独立 weather scheduler 的启动链路。

## 阶段一：扩展世界状态类型

### 修改文件

- `packages/utils/src/types/state.ts`
- `packages/utils/src/redis/state/world.ts`
- `packages/world/src/state/world-state.ts`

### 修改内容

1. 在 `WorldStateData` 中增加 `lastAdvancedAt`。

   作用：
   - 表示世界状态最后一次被推进到的真实时间。
   - `WorldRunner` 启动恢复和固定 tick 都以它作为 `fromTime`。

2. 在 `InventoryItemCategory` 中增加 `Valuable = "valuable"`。

   作用：
   - 表达海岸可拾取的高价值物品。
   - 这类物品主要用于售卖，不参与食用和料理。

3. 在 `WorldStateData` 中增加 `scenes`。

   第一版建议只覆盖当前需求需要的最小结构：

   ```ts
   interface WorldSceneState {
     isOpen?: boolean;
     changedAt?: string | null;
     resources?: WorldSceneResourceState[];
   }

   interface WorldSceneResourceState {
     name: string;
     amount: number;
     lastRefreshedAt: string | null;
   }
   ```

   `resources` 放在 scene 内部，直接存具体物品数组，例如：

   ```ts
   scenes: {
     park: {
       resources: [
         { name: "野莓", amount: 0, lastRefreshedAt: null },
         { name: "青苹果", amount: 0, lastRefreshedAt: null },
         { name: "南风桃", amount: 0, lastRefreshedAt: null },
       ],
     },
     coast: {
       resources: [
         { name: "星砂贝壳", amount: 0, lastRefreshedAt: null },
         { name: "海玻璃", amount: 0, lastRefreshedAt: null },
         { name: "月汐珍珠", amount: 0, lastRefreshedAt: null },
       ],
     },
   }
   ```

   `isOpen` 是可选字段。没有 `isOpen` 的场景代表永久开放，不需要额外写 `isOpen: true`。

4. 更新 `IWorldState`。

   需要补充：
   - `lastAdvancedAt`
   - `scenes`
   - 一个整体写入世界状态的方法，例如 `setData(data: WorldStateData)` 或 `replaceData(data: WorldStateData)`

   说明：
   - `WorldRunner` 需要保存领域演进类返回的新状态。
   - 现有 `setWeather()` 可以保留，避免影响短期内的调用方。

5. 更新 Redis 读写。

   `initWorldStateData()` 需要解析：
   - `lastAdvancedAt`
   - `weather`
   - `scenes`

   `saveWorldStateData()` 需要写入：
   - `time`
   - `lastAdvancedAt`
   - `weather`
   - `scenes`

### 注意事项

- 不新增新的 Redis key，继续使用现有 `REDIS_KEY_WORLD_STATE`。
- 对缺失字段做初始化，不做多套兼容状态源。
- `lastAdvancedAt` 缺失时初始化为当前时间，避免首次启动补算过长历史。

## 阶段二：新增世界演进契约

### 新增文件

- `packages/world/src/engine/world/evolution.ts`

### 修改内容

新增抽象基类和上下文类型：

```ts
export abstract class WorldEvolution {
  abstract precondition(context: WorldAdvanceContext): boolean | Promise<boolean>;
  abstract advance(context: WorldAdvanceContext): Promise<WorldStateData>;
}
```

建议同时定义：

```ts
export interface WorldAdvanceContext {
  fromTime: Date;
  toTime: Date;
  deltaMs: number;
  worldStateData: WorldStateData;
  commands: WorldCommand[];
}
```

### 注意事项

- 不放 `name` 和 `description`。
- `precondition` 必须保留，由领域演进类自己判断本轮是否需要执行。
- `WorldRunner` 只按显式数组顺序调用，不根据名称查找。

## 阶段三：新增 WorldRunner

### 新增文件

- `packages/world/src/engine/world/runner.ts`
- `packages/world/src/engine/world/index.ts`

### 修改内容

`WorldRunner` 负责：

- `start()`
- `stop()`
- `recoverToNow()`
- `runTick()`

主流程：

1. 通过现有 `worldState` 获取 `WorldStateData`。
2. 用 `lastAdvancedAt` 和当前真实时间构造 `WorldAdvanceContext`。
3. 读取本轮世界命令。
4. 按显式数组顺序检查每个 `WorldEvolution.precondition()`。
5. 对满足条件的领域演进类调用 `advance()`。
6. 将每个演进类返回的新 `WorldStateData` 继续传给下一个演进类。
7. 更新 `lastAdvancedAt` 和 `time`。
8. 通过现有 `worldState` 保存新状态。
9. 结束本轮推进。

第一版领域演进顺序：

```ts
[new WeatherEvolution(), new SceneEvolution(), new ResourceEvolution()];
```

### 注意事项

- `WorldRunner` 不写天气、场景、资源业务判断。
- `WorldRunner` 只做编排和状态落盘。
- 世界 tick 与角色 action loop 独立运行。
- fixed tick 间隔先用显式常量，不新增隐藏环境变量。

## 阶段四：迁移 weather 到 WeatherEvolution

### 修改 / 新增文件

- `packages/world/src/engine/weather/service.ts`
- `packages/world/src/engine/weather/scheduler.ts`
- `packages/world/src/engine/weather/index.ts`
- `packages/world/src/engine/world/weather-evolution.ts`
- `packages/world/src/main.ts`

### 修改内容

1. 保留现有天气生成能力。

   可继续复用：
   - `generateWeatherSnapshot`
   - `resolveWeatherPeriod`
   - `buildWeatherChangedEpisode`

2. 将 `syncCurrentWeather()` 的核心逻辑迁入 `WeatherEvolution.advance()`。

   `WeatherEvolution` 负责：
   - 判断当前天气是否仍在当前时间片。
   - 根据 `fromTime -> toTime` 推进天气状态。
   - 返回更新后的 `WorldStateData`。

3. 移除独立 weather scheduler 启动。

   `main.ts` 不再调用：
   - `syncCurrentWeather()`
   - `startWeatherScheduler()`

   天气由 `WorldRunner` 在启动恢复和固定 tick 中统一推进。

4. weather 旧模块处理。
   - `generator.ts`、`time.ts`、`constants.ts` 可继续保留。
   - `scheduler.ts` 可删除或停止导出，最终不再被主流程使用。
   - `service.ts` 如果仅剩旧入口，可删除或改为内部迁移后的薄封装。

### 注意事项

- 天气变化 Episode 不在第一版世界演进里处理。
- `WeatherEvolution` 只返回更新后的 `WorldStateData`，不直接写外部副作用。

## 阶段五：新增 SceneEvolution

### 新增文件

- `packages/world/src/engine/world/scene-evolution.ts`

### 修改内容

`SceneEvolution` 负责推进 `worldStateData.scenes` 中的场景动态状态。

第一版建议覆盖：

- 学校
- 小町商店
- 超市
- 日和食堂
- 薄暮咖啡
- 公园
- 水音池
- 结灯神社
- 羽浦町站
- 海岸

第一版状态重点：

- `isOpen`
- `changedAt`

执行逻辑：

- `precondition()` 第一版可以固定返回 `true`。
- `advance()` 根据当前时间、天气和旧场景状态计算新状态。
- 如果开放状态变化，直接体现在返回的 `WorldStateData.scenes` 中。

第一版开放时间：

- `school`：08:00-17:00。
- `shop`：09:00-21:00。
- `supermarket`：09:00-21:00。
- `diner`：07:00-20:00。
- `cafe`：10:00-20:00。

第一版永久开放场景：

- `home`
- `park`
- `pond`
- `shrine`
- `trainStation`
- `coast`

### 注意事项

- 不是所有场景都需要 `isOpen`。
- 没有 `isOpen` 的场景代表永久开放。
- 不把开放规则写成配置表 DSL。
- 可以在 `SceneEvolution` 内部直接用清晰代码表达第一版业务规则。
- 不要把 Action 的可执行判断写进 `SceneEvolution`，这里只负责世界事实本身。

## 阶段六：新增 ResourceEvolution

### 新增文件

- `packages/world/src/engine/world/resource-evolution.ts`

### 修改内容

`ResourceEvolution` 负责推进 `scenes` 内部的资源状态。

第一版建议覆盖：

- 公园水果资源
- 海岸高价值物品资源

水音池鱼资源不进入世界资源系统。鱼视为无限资源，继续由现有 `Fish_At_Pond` Action 自己处理钓鱼结果。

执行逻辑：

- `precondition()` 判断当前世界状态中是否存在需要推进的场景资源。
- `advance()` 根据 `fromTime -> toTime`、当前天气、场景状态和旧资源状态计算新资源数量。
- 如果资源刷新或恢复，直接体现在返回的 `WorldStateData.scenes` 中。

第一版资源设计：

- `scenes.park.resources`
  - 直接存南风公园可采集的具体水果物品。
  - 每天刷新一次，当天水果总量随机为 `1~5`，再分配到各个水果物品上。
  - 采集到的水果写入背包时，同时使用 `InventoryItemCategory.Food` 和 `InventoryItemCategory.Ingredient`。
  - 第一版水果池：
    - `野莓`：`metadata: { stamina: 3, satiety: 8, mood: 1, salePrice: 8 }`
    - `青苹果`：`metadata: { stamina: 5, satiety: 12, mood: 1, salePrice: 12 }`
    - `南风桃`：`metadata: { stamina: 6, satiety: 16, mood: 2, salePrice: 20 }`
- `scenes.coast.resources`
  - 直接存月汐海岸可拾取的具体高价值物品。
  - 每天刷新一次，当天高价值物品总量随机为 `0~2`，可能完全不刷新。
  - 定位为低频、高价值、可售卖资源。
  - 需要在 `InventoryItemCategory` 中新增 `Valuable = "valuable"`。
  - 第一版高价值物品池：
    - `星砂贝壳`：`metadata: { salePrice: 60 }`
    - `海玻璃`：`metadata: { salePrice: 90 }`
    - `月汐珍珠`：`metadata: { salePrice: 180 }`

### 注意事项

- 资源状态存在对应场景内。
- 角色行为消耗资源不直接改 Redis 字段，应通过世界命令进入 `WorldRunner`。
- 第一版可以先只处理时间驱动刷新，角色行为消费在后续 Action 接入阶段实现。
- 水音池鱼不通过 `scenes.pond.resources` 表达，也不通过世界命令消耗。

## 阶段七：世界命令

### 新增文件

- `packages/world/src/engine/world/command.ts`

### 修改内容

第一版定义最小命令类型：

```ts
type WorldCommand = { type: 'consume_scene_resource'; scene: string; resource: string; amount: number };
```

### 注意事项

- 命令先以内存队列或 `WorldRunner` 内部输入表达，暂不设计跨进程命令队列。
- 第一版不引入 `WorldEvent`。
- 世界状态变化如果未来需要写记忆、日志或通知，再补对应事件机制。

## 阶段八：启动链路接入

### 修改文件

- `packages/world/src/main.ts`
- `packages/world/src/engine/runner.ts`

### 修改内容

1. `main.ts` 启动时：
   - `connectDB()`
   - `initState()`
   - 启动 `WorldRunner`
   - 启动角色 realtime loop

2. 移除独立 weather 启动：
   - 不再调用 `syncCurrentWeather()`
   - 不再调用 `startWeatherScheduler()`

3. 角色 loop 保持独立。

   `packages/world/src/engine/runner.ts` 继续只处理角色 action loop，不把世界演进塞回 action lifecycle。

### 注意事项

- `WorldRunner` 和角色 loop 是两个独立运行流。
- 如果两个 loop 都需要常驻，`main.ts` 需要明确处理并发启动和进程退出。

## 阶段九：消费方适配

### 修改文件

- `packages/utils/src/llm/tools/query-state.ts`
- `packages/utils/src/prompt/world-view.ts`
- `packages/utils/src/prompt/proactive-message.ts`
- `packages/web/app/api/nodejs/[[...route]]/home.ts`
- `packages/web/app/home/home-world-card.tsx`

### 修改内容

1. `queryStateTool`
   - 继续读取 `initWorldStateData()`。
   - 返回 weather。
   - 后续按需返回简化后的 scene 状态。

2. prompt 相关逻辑
   - `world-view.ts` 第一版可以只继续展示天气。
   - 如果 Action 决策要感知场景开放状态，再把 `scenes` 加入公共状态文本。

3. Web 首页
   - `buildHomeWorldPayload()` 继续输出 weather。
   - 第一版可以不展示 scenes，避免 UI 范围扩散。

### 注意事项

- 消费方先保证类型兼容。
- 不在本次顺手做复杂 UI 展示。

## 阶段十：Action 接入世界状态

### 修改文件

- `packages/world/src/action/business-district/shop.ts`
- `packages/world/src/action/business-district/cafe.ts`
- `packages/world/src/action/school/campus.ts`
- 其他受场景开放或资源影响的 Action 文件

### 修改内容

1. 场景开放状态接入 `precondition`。

   例如：
   - 商店关闭时不能购买。
   - 咖啡店关闭时不能点咖啡或打工。
   - 学校关闭时不能学习。

   判断规则：
   - 场景有 `isOpen` 字段时，按 `isOpen` 判断。
   - 场景没有 `isOpen` 字段时，视为永久开放。

2. 场景资源状态接入 Action。

   例如：
   - 采集公园水果时，在 `scenes.park.resources` 数组中按 `name` 找到 `野莓`、`青苹果`、`南风桃` 对应资源并消耗。
   - 拾取海岸高价值物品时，在 `scenes.coast.resources` 数组中按 `name` 找到 `星砂贝壳`、`海玻璃`、`月汐珍珠` 对应资源并消耗。
   - 水音池钓鱼不接入世界资源，继续按现有无限资源逻辑处理。

### 注意事项

- 每个 Action 的 `precondition` 仍然要清晰。
- 不在 Action 内直接修改 `WorldStateData.scenes`。
- Action 影响世界时通过世界命令进入 `WorldRunner`。

## 阶段十一：验证

### 必跑命令

```bash
pnpm run format:write
pnpm run lint
pnpm run type-check
```

### 建议补充验证

- 启动世界进程后，确认 `WorldRunner` 会恢复并推进 `lastAdvancedAt`。
- 删除 Redis 中新增字段后启动，确认初始化状态可用。
- 让 weather 时间片过期，确认 `WeatherEvolution` 能产出新天气。
- 模拟场景开放状态变化，确认 `SceneEvolution` 会更新 `scenes`。
- 模拟资源刷新，确认资源写在对应 scene 内部。

## 明确不在第一版范围

- 不拆新 package。
- 不做 ECS。
- 不做规则配置 DSL。
- 不新增独立 `WorldState` class。
- 不做复杂跨进程世界命令队列。
- 不做 Web 场景状态完整展示。
- 不一次性改完所有 Action，只优先接入第一批受场景开放和资源影响的 Action。
