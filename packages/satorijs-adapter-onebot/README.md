# @yuiju/satorijs-adapter-onebot

OneBot 的 Satori adapter，本仓库基于旧版 `@satorijs/adapter-onebot` 改造后内置使用。

## 当前职责

- 作为 `@yuiju/message` 的 OneBot 平台接入层。
- 将 OneBot WebSocket 能力适配到 Satori Bot 接口。
- 暴露给 message 服务统一处理私聊和群聊消息。

## 配置入口

本包不直接读取项目配置。`@yuiju/message` 从根目录 `yuiju.config.ts` 读取 `message.onebot` 后创建 adapter 实例。

## 修改注意事项

- 本包属于平台适配层，不承载消息回复、记忆写入或角色领域规则。
- 修改协议行为时，需要同步验证 `@yuiju/message` 的私聊、群聊和主动发送链路。
