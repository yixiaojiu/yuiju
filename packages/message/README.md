# 消息服务 (@yuiju/message)

`@yuiju/message` 是外部消息入口，负责接入 OneBot / Lark，标准化平台消息，调用 LLM 生成回复，并维护私聊、群聊上下文。

## 当前职责

- 通过 Satori 接入 OneBot 和 Lark。
- 根据 `message.onebot` / `message.lark` 白名单处理私聊和群聊。
- 将平台消息转换成统一的内部消息结构。
- 维护私聊、群聊历史、滚动摘要和记忆写入边界。
- 启动内部 HTTP API，供 world 触发主动消息和读取群聊上下文。
- 根据 `message.stickers` 配置加载可用表情包。

## 主要目录

```text
src/
├── server.ts          # 生产和开发入口
├── internal-api.ts    # 内部 HTTP API
├── handler/           # 私聊和群聊入口流程
├── llm/               # 会话上下文与回复生成
├── memory/            # 消息 Episode 与人物记忆写入
├── state/             # 图片缓存、表情状态
└── utils/             # 平台消息标准化与发送辅助
```

## 配置与依赖

消息服务读取根目录 `yuiju.config.ts`：

- `database.mongoUri`
- `llm.models`
- `message.onebot`
- `message.lark`
- `message.internalApi`
- `message.stickers`

平台依赖：

- `@satorijs/core`
- `@yuiju/satorijs-adapter-onebot`
- `@satorijs/adapter-lark`

## 运行命令

```bash
pnpm run dev:message
pnpm run start:message
pnpm run demo:message
pnpm run type-check:message
```

## 修改注意事项

- Handler 只表达入口流程和副作用编排，不承载复杂领域规则。
- 面向用户的回复不能暴露 Action、schema、字段名或内部流程。
- 白名单和 owner 判断必须在调用 LLM 或发送消息前完成。
- 群聊新消息替换旧回复请求时，旧请求不应继续发送过期回复。
