# 新人上手指南

## 1. 项目介绍

`yuiju` 是一个 **LLM Agent 驱动的角色生活模拟系统**。  
系统通过 **State -> Decision -> Action -> Update** 的闭环，让角色在动态环境中持续决策与行为演化，而不是依赖固定脚本。

项目采用 `pnpm workspace` 多包架构，主要模块如下：

- `packages/world`：世界引擎（Tick 循环、动作系统、状态管理、LLM 决策）
- `packages/web`：Web 展示与 API 通道（Next.js + Hono）
- `packages/message`：消息服务入口
- `packages/utils`：公共能力（类型、DB、Redis、工具函数）
- `packages/source`：Prompt 与数据源
- `packages/python`：Python 侧服务（按需使用）

## 2. 项目能力

- **Agent Tick 决策闭环**：已实现 State -> Decision -> Action -> Update 的持续循环，支持角色行为长期演化。
- **参数化动作决策**：支持“做什么 / 做多久 / 如何执行（参数）”的细粒度规划，覆盖食物、商店、咖啡店等行为场景。
- **多端数据通道**：提供 Web API 与消息服务入口，支持角色状态与行为轨迹的查询和展示。
- **工程质量保障**：基于 TypeScript + Vitest，具备 lint / type-check / test 校验链路，便于持续迭代。

## 3. 如何启动

### 3.1 运行环境

- Node.js：`24`（见根目录 `.node-version`）
- pnpm：`10.14.x`（建议与仓库声明版本一致）
- Redis：本地可用
- MongoDB：本地可用

### 3.2 项目配置

当前项目的业务配置统一来自项目根目录的 `yuiju.config.ts`，而不是旧文档中的 `.env.example`。

1. 基于示例文件创建本地配置：

```bash
cp yuiju.config.ts.example yuiju.config.ts
```

2. 至少确认以下配置项：

- `app.publicDeployment`：是否启用对外展示模式
- `database.mongoUri`：MongoDB 连接地址
- `database.redisUrl`：Redis 连接地址
- `llm.deepseekApiKey`：DeepSeek 调用凭据
- `message.napcat`：NapCat WebSocket 连接信息
- `message.whiteList` / `message.groupWhiteList`：消息服务白名单

3. 额外说明：

- `NODE_ENV` 仍然是运行时环境变量，不放在 `yuiju.config.ts` 中
- `yuiju.config.ts` 是本地真实配置，通常不提交到仓库
- 如果暂时不启动消息服务，可以先保留 `message` 下的默认结构，按实际环境补全连接参数

### 3.3 启动步骤（推荐）

1. 安装依赖：

```bash
pnpm install
```

2. 启动世界引擎：

```bash
pnpm run dev:world
```

3. 启动 Web 界面：

```bash
pnpm run dev:web
```

4. 按需启动消息服务：

```bash
pnpm run dev:message
```

5. 仅在需要 Python 侧能力时启动 Python 服务：

```bash
pnpm run start:python
```

### 3.4 常用校验命令

```bash
pnpm run format:write
pnpm run lint
pnpm run type-check
pnpm run test:world
```

### 3.5 常见问题

- `git pull` 报错 `Could not read from remote repository`：通常是 SSH key 或仓库权限问题，不影响本地开发。
- 启动时报 Redis/Mongo 连接错误：先确认本地服务是否启动，再检查 `yuiju.config.ts` 中的 `database.redisUrl` 和 `database.mongoUri`。
- 启动消息服务失败：优先检查 `yuiju.config.ts` 中的 `message.napcat` 配置，以及 NapCat 服务本身是否可连接。
- Web 页面接口报数据库不可用：`web` 会在启动时尝试连接 MongoDB，若 `database.mongoUri` 为空或服务不可达，部分接口会不可用。

## 4. 项目部署（PM2）

项目生产部署使用 PM2，配置文件为根目录 `ecosystem.config.js`。

### 4.1 PM2 管理的应用

- `yuiju-message`：消息服务（`pnpm run start:message`）
- `yuiju-world`：世界引擎（`pnpm run start:world`）
- `yuiju-web`：Web 服务（`pnpm run build:web && pnpm run start:web`）
- `yuiju-python`：Python 服务（`pnpm run start:python`）

### 4.2 常用部署命令

仓库根目录已经封装了常用 PM2 命令，推荐优先使用：

1. 首次启动全部应用：

```bash
pnpm run start
```

2. 查看运行状态与日志：

```bash
pm2 status
pm2 logs
```

3. 重启全部应用：

```bash
pnpm run restart
```

4. 停止全部应用：

```bash
pnpm run stop
```

如果你更习惯直接使用 PM2，也可以执行等价命令：

1. 首次启动全部应用：

```bash
pm2 start ecosystem.config.js
```

2. 查看运行状态与日志：

```bash
pm2 status
pm2 logs
```

3. 重启全部或单个应用：

```bash
pm2 restart ecosystem.config.js
pm2 restart yuiju-web
```

4. 停止和删除进程：

```bash
pm2 stop ecosystem.config.js
pm2 delete ecosystem.config.js
```

5. 设置开机自启（服务器场景）：

```bash
pm2 startup
pm2 save
```

### 4.3 部署注意事项

- 生产部署前建议先执行：

```bash
pnpm install
pnpm run format:write
pnpm run lint
pnpm run type-check
```

- 部署机器需要提前准备好项目根目录的 `yuiju.config.ts`，至少补全 `database.mongoUri`、`database.redisUrl`、`llm.deepseekApiKey` 等关键配置。
- 当前根目录 `package.json` 没有声明 `pm2` 依赖，`pnpm run start` / `pnpm run stop` / `pnpm run restart` 依赖系统里已有可用的 `pm2` 命令。
- `ecosystem.config.js` 中当前配置了 `autorestart: false`，若需要异常自动拉起，需要按运维策略调整。
- `yuiju-web` 在 PM2 中会先执行构建再启动；如果只想更新前端服务，建议先确认构建环境可用，再执行 `pm2 restart yuiju-web`。
