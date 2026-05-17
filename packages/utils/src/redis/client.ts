import Redis from "ioredis";
import { getYuijuConfig } from "../config";

let redis: Redis | null = null;
let syncRedis: Redis | null = null;

export type RedisReadSource = "primary" | "sync";

export type RedisHashFields = Record<string, string | number | Buffer>;

export type SyncRedisStateWrite =
  | {
      command: "hset";
      key: string;
      fields: RedisHashFields;
    }
  | {
      command: "set";
      key: string;
      value: string;
    };

export const hasSyncRedisUrl = (): boolean => {
  return Boolean(getYuijuConfig().database.syncRedisUrl?.trim());
};

export const getRedis = (source: RedisReadSource = "primary") => {
  if (source === "primary") {
    if (!redis) {
      const redisUrl = getYuijuConfig().database.redisUrl.trim();
      redis = new Redis(redisUrl);
    }
    return redis;
  }

  const syncRedisUrl = getYuijuConfig().database.syncRedisUrl?.trim();
  if (!syncRedisUrl) {
    throw new Error("database.syncRedisUrl is not configured, cannot read from sync Redis");
  }

  if (!syncRedis) {
    syncRedis = new Redis(syncRedisUrl);
  }
  return syncRedis;
};

export const closeRedis = async () => {
  if (redis) {
    await redis.quit();
    redis = null;
  }

  if (syncRedis) {
    await syncRedis.quit();
    syncRedis = null;
  }
};

export const syncRedisStateWrite = async (write: SyncRedisStateWrite): Promise<void> => {
  if (!hasSyncRedisUrl()) {
    return;
  }

  try {
    const redis = getRedis("sync");

    if (write.command === "hset") {
      await redis.hset(write.key, write.fields);
      return;
    }

    await redis.set(write.key, write.value);
  } catch (error) {
    console.error(`Sync Redis write failed: ${write.key}`, error);
  }
};
