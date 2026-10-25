import { getRedis } from "@yuiju/shared/database/redis";
import {
  type SceneResponse,
  sceneRequestChannel,
  sceneRequestSchema,
} from "@yuiju/shared/extension/scene-requests";
import { logger } from "@yuiju/shared/logger/logger";
import type { AgentControl } from "../agent-loop/control";

/** 每角色订阅一个命令通道；业务状态仍由 AgentControl 管理。 */
export async function listenSceneRequests(
  characterId: string,
  control: AgentControl,
): Promise<() => void> {
  const redis = await getRedis();
  const subscriber = redis.duplicate({ lazyConnect: true });
  const channel = sceneRequestChannel(characterId);
  let stopped = false;
  subscriber.on("error", (error) => logger.error("场景请求通道连接失败", { error }));
  subscriber.on("message", async (_channel, message) => {
    try {
      const request = sceneRequestSchema.parse(JSON.parse(message));
      let response: SceneResponse;
      try {
        if (stopped || request.expiresAt <= Date.now()) {
          throw new Error("场景请求已过期或角色正在停止");
        }
        const command = request.command;
        const value =
          command.type === "prepare"
            ? await control.requestUserEntry(command.agentId, command.context)
            : control.readStatus(command.agentId, command.sessionId);
        response = { ok: true, value };
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await redis.publish(`${channel}:${request.id}`, JSON.stringify(response));
    } catch (error) {
      logger.error("场景请求处理失败，不再重试", { error });
    }
  });
  try {
    await subscriber.connect();
    await subscriber.subscribe(channel);
  } catch (error) {
    subscriber.disconnect();
    throw error;
  }
  return () => {
    stopped = true;
    subscriber.disconnect();
  };
}
