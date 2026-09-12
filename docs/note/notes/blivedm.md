# Bilibili 直播弹幕接入调研

## 结论

本项目后续如果需要接入 Bilibili 直播间弹幕能力，建议按两条链路处理：

1. 直播间弹幕监听：使用 `blive-message-listener`
2. 直播间发送弹幕：直接调用 Bilibili 直播弹幕 HTTP 接口

监听和发送不是同一条协议链路。监听实时弹幕走 WebSocket，发送弹幕走 HTTP POST。

## 直播间弹幕监听

推荐使用：

https://github.com/ddiu8081/blive-message-listener

对应 npm 包：

https://www.npmjs.com/package/blive-message-listener

选择原因：

- 面向 Bilibili 直播间弹幕监听场景，封装程度比底层 WebSocket 库更高。
- 支持 Node 环境和浏览器环境。
- 支持 TypeScript 类型。
- 会把原始 Bilibili 弹幕消息转换成更适合业务使用的结构。
- 支持监听普通弹幕、醒目留言、礼物、上舰、直播状态、点赞、用户进入等消息。
- 底层基于 `tiny-bilibili-ws`，可以通过 `options.ws` 继续传入 Cookie、uid、key、buvid 等连接参数。

基础用法示意：

```ts
import { startListen, type MsgHandler } from 'blive-message-listener'

const handler: MsgHandler = {
  onIncomeDanmu: (msg) => {
    console.log(msg.body.user.uname, msg.body.content)
  },
  onIncomeSuperChat: (msg) => {
    console.log(msg.body.user.uname, msg.body.content)
  },
}

const instance = startListen(roomId, handler)

// 停止监听
instance.close()
```

注意事项：

- `blive-message-listener` 文档提示，监听时应传入直播间长 ID；短 ID 需要先转换成长 ID。
- 2023 年 7 月后，如果不带登录态，弹幕发送者用户名可能不完整或被风控处理。
- 如果需要更完整的用户信息，可以在 `options.ws` 中传入 Cookie 和 uid。

示意：

```ts
startListen(roomId, handler, {
  ws: {
    headers: {
      Cookie: 'SESSDATA=xxx; bili_jct=xxx',
    },
    uid: 123456,
  },
})
```

## 直播间发送弹幕

发送弹幕不需要走监听弹幕的 WebSocket。普通直播间发送消息本质上是调用一个 HTTP 接口：

```text
POST https://api.live.bilibili.com/msg/send
```

认证依赖登录 Cookie：

```text
SESSDATA=xxx; bili_jct=xxx
```

其中：

- `SESSDATA` 用于证明账号已登录。
- `bili_jct` 是 CSRF Token。
- 表单里的 `csrf` 需要和 Cookie 中的 `bili_jct` 一致。

核心表单参数：

```text
roomid       直播间 ID
msg          弹幕内容
rnd          当前 Unix 秒时间戳
fontsize     字体大小，通常 25
color        十进制颜色值，通常 16777215
mode         弹幕模式，通常 1 表示滚动弹幕
csrf         bili_jct 的值
csrf_token   通常同 csrf
```

Node/TypeScript 请求示意：

```ts
await fetch('https://api.live.bilibili.com/msg/send', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    cookie: `SESSDATA=${sessdata}; bili_jct=${biliJct}`,
  },
  body: new URLSearchParams({
    roomid: String(roomId),
    msg,
    rnd: String(Math.floor(Date.now() / 1000)),
    fontsize: '25',
    color: '16777215',
    mode: '1',
    csrf: biliJct,
    csrf_token: biliJct,
  }),
})
```

发送接口常见失败原因：

- Cookie 失效或未登录。
- `csrf` 和 `bili_jct` 不一致。
- 弹幕内容超长。
- 发送频率过快。
- 账号等级、房间状态或平台风控限制。

因此业务层需要做：

- Cookie 安全保存，避免写入前端或日志。
- 发送频率限制。
- 错误码处理和重试策略。
- 弹幕长度限制，必要时拆分消息。

## 推荐集成方式

建议在业务代码中拆成两个独立模块：

1. `LiveDanmakuListener`
   - 负责调用 `blive-message-listener`
   - 把直播间弹幕、礼物、SC 等事件转换成项目内部事件

2. `LiveDanmakuSender`
   - 负责调用 `POST /msg/send`
   - 管理 Cookie、csrf、发送频率和错误处理

这样可以避免把 WebSocket 监听逻辑和 HTTP 发送逻辑耦合在一起，后续更换监听库或发送实现时影响范围也更小。
