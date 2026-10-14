import { once } from "node:events";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { logger } from "@yuiju/shared/logger/logger";
import type { WorldEventQueues } from "../queue";
import type { World } from "../world";
import { createWorldHttpApp } from "./http";
import { attachWorldWebSocket } from "./websocket";

/** 组装共用端口的 HTTP 与 WS；关闭时先等待事件通道清理，再关闭 HTTP。 */
export async function serveWorld(
  world: World,
  queues: WorldEventQueues,
  options: { host: string; port: number; token: string | undefined },
) {
  const app = createWorldHttpApp(world, options.token);
  const server = createServer(getRequestListener(app.fetch));
  const webSocket = attachWorldWebSocket(server, world, queues, options.token);

  // 监听地址来自配置，默认仅本机；角色配置的 base_url 仅用于客户端连接。
  server.listen(options.port, options.host);
  try {
    await once(server, "listening");
  } catch (error) {
    await webSocket.stop();
    throw error;
  }

  logger.info("世界服务已启动", { address: server.address() });

  return {
    async stop(): Promise<void> {
      await webSocket.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
