# 第三方依赖

本文只记录当前实现中仍然有效的外部依赖和配置边界。

## 配置来源

业务配置统一来自项目根目录 `yuiju.config.ts`。

- TypeScript 包通过 `@yuiju/utils` 的 `getYuijuConfig()` 读取配置。
- `NODE_ENV` 仍然是运行时环境变量，不放进 `yuiju.config.ts`。
- 日志相关运行时参数仍通过环境变量读取，例如 `LOG_LEVEL`、`LOG_MAX_SIZE`、`LOG_MAX_FILES`。
- Python 侧会优先通过 Node/tsx 读取 `yuiju.config.ts`，部分 Graphiti 敏感信息仍从环境变量读取。

不要新增分散的 `.env`、子包 `config.ts` 或隐式配置来源。

## 基础存储

### Redis

用途：

- 角色实时状态。
- 世界实时状态。
- 计划等运行期状态。

配置：

- `database.redisUrl`
- `database.syncRedisUrl` 仅用于公开部署等只读同步场景。

约束：

- Redis 是 Character/World 实时状态的真相源。
- 不要把实时状态长期复制到 MongoDB 再互相兜底。

### MongoDB

用途：

- 行为历史。
- `MemoryEpisode`。
- `Diary`。
- 消息记录和其他可追溯记录。

配置：

- `database.mongoUri`
- `database.syncMongoUri` 仅用于公开部署等只读同步场景。

约束：

- MongoDB 保存历史事实，不替代 Redis 的实时状态。
- 新增长期事件类型时，需要明确是否写入 `MemoryEpisode`。

## LLM Provider

TypeScript 侧通过 AI SDK 的 OpenAI-compatible provider 调用模型。

配置来自 `llm.models`：

- `chat`
- `strong`
- `flash`
- `vision`

每个类型至少需要一个 `{ baseUrl, apiKey, model }` source。具体语义见 [LLM 协定](./llm-contract.md)。

## 消息平台

消息入口由 Satori 统一承接。

### OneBot

包：

- `@yuiju/satorijs-adapter-onebot`

配置：

- `message.onebot.endpoint`
- `message.onebot.token`
- `message.onebot.selfId`
- `message.onebot.whiteList`
- `message.onebot.ownerList`
- `message.onebot.groupWhiteList`

### Lark / 飞书

包：

- `@satorijs/adapter-lark`

配置：

- `message.lark.endpoint`
- `message.lark.appId`
- `message.lark.appSecret`
- `message.lark.whiteList`
- `message.lark.ownerList`
- `message.lark.groupWhiteList`

### Message Internal API

`@yuiju/message` 还会启动内部 HTTP 服务，供 world 等内部流程触发主动消息、读取群聊上下文或获取表情信息。

配置：

- `message.internalApi.host`
- `message.internalApi.port`

## Python / Graphiti

`packages/python` 是按需启动的长期记忆图谱服务。

职责：

- 接收 TS 侧准入后的 Episode。
- 写入 Graphiti 图谱。
- 提供语义检索接口。

主要依赖：

- FastAPI
- Uvicorn
- Graphiti
- Neo4j
- OpenAI-compatible LLM / embedding / rerank provider

边界：

- Python 服务不决定业务事件是否发生。
- Graphiti 抽取结果不是实时状态真相源。
- 如果 Python 服务不可用，应该回到调用它的业务流程决定是否失败、重试或跳过，不在文档中假设默认降级。

## Docker 与 PM2

### 本地基础依赖

`docker-compose.infra.yml` 只启动 MongoDB 和 Redis，适合本地开发。

### 单镜像部署

`docker-compose.yml` 构建应用镜像，并编排 MongoDB 与 Redis。

当前 TypeScript 配置读取器只读取根目录 `yuiju.config.ts`。Compose 中传入的 `YUIJU_*` 环境变量不会自动覆盖配置，除非本地 `yuiju.config.ts` 显式读取这些环境变量。

### PM2

`ecosystem.config.js` 当前管理：

- `yuiju-message`
- `yuiju-world`
- `yuiju-web`

Python 服务可以通过 `pnpm run start:python` 单独启动；当前 PM2 配置没有管理 `yuiju-python`。
