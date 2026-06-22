# Python 记忆服务

`packages/python` 是按需启动的长期记忆图谱服务，基于 FastAPI 和 Graphiti。

## 当前职责

- 接收 TS 侧已经准入的 `MemoryEpisode`。
- 将 Episode 写入 Graphiti 图谱。
- 提供长期记忆语义检索。
- 使用受控 ontology 抽取角色、偏好目标和长期关系。

Python 服务不决定业务事件是否发生，也不替代 Redis 或 MongoDB 的真相源。

## API

### GET /healthz

健康检查。

### POST /v1/episodes

写入单个 Episode。

请求体：

```json
{
  "is_dev": true,
  "episode": {
    "id": "mongo-episode-id",
    "source": "world",
    "type": "action_completed",
    "subject": "ゆいじゅ",
    "counterparty": null,
    "happenedAt": "2026-06-22T12:00:00.000Z",
    "summaryText": "ゆいじゅ在公园散步。",
    "payload": {}
  }
}
```

### POST /v1/search

检索长期记忆。

请求体：

```json
{
  "is_dev": true,
  "query": "最近有什么稳定偏好？",
  "top_k": 5,
  "filters": null
}
```

## 主要文件

```text
graphiti_client.py  # Graphiti 客户端和模型配置桥接
server.py           # FastAPI 服务和 ontology 定义
pyproject.toml      # Python 依赖
```

## 配置与依赖

- Python 侧会尝试通过 Node/tsx 读取根目录 `yuiju.config.ts`。
- Graphiti / Neo4j / embedding / rerank 相关敏感信息仍可能来自环境变量。
- 具体第三方依赖边界见 [第三方依赖](../../docs/third-party-dependencies.md)。

## 运行命令

```bash
pnpm run start:python
```

或在本目录内：

```bash
uv sync
uv run uvicorn server:app --host 0.0.0.0 --port 9196
```
