import { once } from "node:events";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { logger } from "@yuiju/shared/logger/logger";
import type { Character } from "../character";
import { createCharacterHttpApp } from "./http";

/** 监听端口来自启动参数，连接用的 runtime.base_url 不参与监听配置。 */
export async function serveCharacter(
  character: Pick<Character, "id" | "conversation">,
  port: number,
) {
  const app = createCharacterHttpApp(character);
  const server = createServer(getRequestListener(app.fetch));
  server.listen(port, "0.0.0.0");
  await once(server, "listening");
  logger.info("角色 HTTP 服务已启动", { port });
  return {
    async stop(): Promise<void> {
      // close 停止接受连接并等待在途 HTTP 请求，角色业务实例此时仍保持运行。
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
