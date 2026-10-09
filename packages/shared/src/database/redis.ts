import Redis from "ioredis";
import { load_config } from "../config/load";
import { logger } from "../logger/logger";

const clients: Partial<Record<"primary" | "sync", Redis>> = {};
const connections: Partial<Record<"primary" | "sync", Promise<void>>> = {};

/** 共用连接；断线期间命令直接失败，不在客户端排队重放业务提交。 */
export async function getRedis(source: "primary" | "sync" = "primary"): Promise<Redis> {
  const config = await load_config();
  const field = source === "primary" ? "redis_url" : "sync_redis_url";
  const url = config.database?.[field];
  if (!url) {
    throw new Error(`缺少 database.${field}`);
  }
  let client = clients[source];
  if (!client) {
    client = new Redis(url, {
      ...(source === "sync" ? { commandTimeout: 10_000 } : {}),
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
    });
    client.on("error", (error) => logger.error("Redis 连接失败", { error }));
    clients[source] = client;
    connections[source] = client.connect();
  }
  try {
    await connections[source];
    return client;
  } finally {
    // 首次连接失败仍向上抛出；后续连接状态由 ioredis 管理，不能永远缓存被拒绝的 Promise。
    delete connections[source];
  }
}

/** 先停止业务写入，再断开连接，不在关闭过程中重连。 */
export function closeRedis(): void {
  for (const source of ["primary", "sync"] as const) {
    clients[source]?.disconnect();
    delete clients[source];
    delete connections[source];
  }
}
