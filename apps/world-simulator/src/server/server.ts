import { once } from "node:events";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { logger } from "@yuiju/shared/logger/logger";
import type { WorldEventQueues } from "../queue";
import type { World } from "../world";
import { createWorldHttpApp } from "./http";
import { attachWorldWebSocket } from "./websocket";

/** 组装共用端口的 HTTP 与 WS；关闭时先等待事件通道清理，再关闭 HTTP。 */
export async function serveWorld(world: World, queues: WorldEventQueues) {
  const app = createWorldHttpApp(world);
  const server = createServer(getRequestListener(app.fetch));
  const webSocket = attachWorldWebSocket(server, world, queues);

  // 监听地址由服务端固定管理；角色配置的 base_url 仅用于客户端连接。
  server.listen(48100, "0.0.0.0");
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
