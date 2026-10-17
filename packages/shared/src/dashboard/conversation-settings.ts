import { redisKeyPrefix } from "../database/environment";
import { getRedis } from "../database/redis";
import { logger } from "../logger/logger";

function settingsKey(characterId: string): string {
  return `${redisKeyPrefix()}character:${encodeURIComponent(characterId)}:conversation:settings`;
}

/** 人工开关不设置 TTL；未设置的群保持开启，不随会话上下文清理。 */
export async function readConversationSettings(
  characterId: string,
): Promise<Record<string, boolean>> {
  const values = await (await getRedis()).hgetall(settingsKey(characterId));
  return Object.fromEntries(
    Object.entries(values).map(([groupId, value]) => [groupId, JSON.parse(value)]),
  );
}

/** 保存与通知在同一 Redis 事务中执行；通知只用于唤醒，读取始终以 hash 为准。 */
export async function saveConversationSetting(
  characterId: string,
  groupId: string,
  enabled: boolean,
): Promise<void> {
  const key = settingsKey(characterId);
  const results = await (await getRedis())
    .multi()
    .hset(key, groupId, JSON.stringify(enabled))
    .publish(`${key}:changed`, groupId)
    .exec();
  for (const [error] of results!) {
    if (error) {
      throw error;
    }
  }
}

/** 独立订阅连接；首次启动和每次重连都先订阅再读取，补上断线期间的修改。 */
export async function subscribeConversationSettings(
  characterId: string,
  refresh: () => Promise<void>,
): Promise<() => void> {
  const subscriber = (await getRedis()).duplicate({ lazyConnect: true, autoResubscribe: false });
  const channel = `${settingsKey(characterId)}:changed`;
  let stopped = false;
  let connected = false;
  async function reload(resubscribe: boolean) {
    try {
      if (resubscribe) {
        await subscriber.subscribe(channel);
      }
      if (!stopped) {
        await refresh();
      }
    } catch (error) {
      logger.error("会话设置同步失败", { error });
    }
  }
  subscriber.on("error", (error) => logger.error("会话设置订阅失败", { error }));
  subscriber.on("message", async () => await reload(false));
  subscriber.on("ready", async () => {
    if (connected) {
      await reload(true);
    }
  });
  try {
    await subscriber.connect();
    connected = true;
    await subscriber.subscribe(channel);
    await refresh();
  } catch (error) {
    stopped = true;
    subscriber.disconnect();
    throw error;
  }
  return () => {
    stopped = true;
    subscriber.disconnect();
  };
}
