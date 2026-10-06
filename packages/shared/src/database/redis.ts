import Redis from "ioredis";
import { load_config } from "../config/load";
import { logger } from "../logger/logger";

let client: Redis | undefined;
let connection: Promise<void> | undefined;

/** 共用连接；断线期间命令直接失败，不在客户端排队重放业务提交。 */
export async function getRedis(): Promise<Redis> {
  const config = await load_config();
  if (!config.database?.redis_url) throw new Error("缺少 database.redis_url");
  if (!client) {
    client = new Redis(config.database.redis_url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
    });
    client.on("error", (error) => logger.error("Redis 连接失败", { error }));
    connection = client.connect();
  }
  try {
    await connection;
    return client;
  } finally {
    // 首次连接失败仍向上抛出；后续连接状态由 ioredis 管理，不能永远缓存被拒绝的 Promise。
    connection = undefined;
  }
}

/** 先停止业务写入，再断开连接，不在关闭过程中重连。 */
export function closeRedis(): void {
  client?.disconnect();
  client = undefined;
  connection = undefined;
}
