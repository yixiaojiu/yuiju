import { connectOneBot } from "../conversation/onebot";

// 临时连接配置：填写测试账号及其 OneBot 正向 WebSocket 地址和访问令牌。
const config = {
  protocol: "ws" as const,
  selfId: "填写测试账号 QQ 号",
  endpoint: "ws://127.0.0.1:3001",
  token: "填写 OneBot 访问令牌，无令牌时设为空字符串",
  retryTimes: 6,
  retryInterval: 5_000,
  retryLazy: 60_000,
};

const context = await connectOneBot(config, (session) => {
  console.log("\n消息", {
    id: session.messageId,
    channelId: session.channelId,
    userId: session.userId,
  });
  console.log("XHTML 正文：\n" + session.content);

  // Adapter 将引用单独存放，正文不包含被引用消息。
  if (session.quote) {
    console.log("引用消息 ID：", session.quote.id);
    console.log("引用 XHTML：\n" + session.quote.content);
  }
});

process.once("SIGINT", async () => {
  await context.stop();
});
process.once("SIGTERM", async () => {
  await context.stop();
});
