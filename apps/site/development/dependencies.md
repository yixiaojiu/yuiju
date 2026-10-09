# 外部依赖

本页帮助开发者判断某项能力依赖哪些外部服务，以及应该在哪里配置它们。

## 依赖概览

| 服务 | 用途 | 是否必需 | 配置位置 |
| --- | --- | --- | --- |
| Redis | 角色与世界实时状态 | 是 | `database.redisUrl` |
| MongoDB | 行为、消息、记忆和日记记录 | 是 | `database.mongoUri` |
| LLM Provider | 行为决策、聊天和内容生成 | 是 | `llm.models` |
| OneBot | QQ 消息接入 | 使用 QQ 时 | `message.onebot` |
| 飞书 | 飞书消息接入 | 使用飞书时 | `message.lark` |
| Python / Graphiti / Neo4j | 长期记忆图谱 | 调试图谱记忆时 | Python 运行环境 |

业务配置统一来自根目录 `yuiju.config.json`。

`NODE_ENV` 和日志参数属于运行时环境变量。Python 服务使用的 Graphiti 密钥也由它自己的运行环境提供，不要把这些内容另建为 TypeScript 业务配置。

## Redis 与 MongoDB

两类存储保存不同事实：

- Redis 保存角色、世界和计划等实时状态。
- MongoDB 保存行为历史、`MemoryEpisode`、Diary、消息等可追溯记录。

不要把实时状态复制到 MongoDB 后让两边互相兜底。公开只读部署使用的 `database.syncRedisUrl` 和 `database.syncMongoUri` 也不能替代主连接。

## LLM Provider

TypeScript 服务通过 OpenAI-compatible 接口调用模型。`llm.models` 按用途分为 `chat`、`strong`、`flash` 和 `vision`，每类至少配置一个包含 `baseUrl`、`apiKey` 和 `model` 的来源。

模型选择和失败切换由 `@yuiju/utils/src/llm/models.ts` 管理。模型在业务流程中的权限边界见 [LLM 协定](./llm-contract)。

## 消息平台

Message 使用 Satori 统一接入不同平台。

### OneBot

项目内的 `@yuiju/satorijs-adapter-onebot` 负责 OneBot 接入。开发时需要确认 endpoint、token、机器人账号以及私聊和群聊白名单。

### 飞书

飞书通过 `@satorijs/adapter-lark` 接入，需要配置 App ID、App Secret 以及白名单。

### Message Internal API

Message 还会启动内部 HTTP 服务，供 World 主动发送消息、读取群聊上下文和获取表情信息。监听地址来自 `message.internalApi`。

## Python 与 Graphiti

`packages/python` 是可选的长期记忆图谱服务，主要负责：

- 接收 TypeScript 业务流程确认后的 Episode。
- 将 Episode 写入 Graphiti / Neo4j。
- 提供语义检索接口。

它不决定业务事件是否真实发生，也不保存角色实时状态。只修改 World、Web 或普通消息流程时，不需要启动该服务。
