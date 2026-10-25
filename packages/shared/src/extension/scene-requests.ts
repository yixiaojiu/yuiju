import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redisKeyPrefix } from "../database/environment";
import { getRedis } from "../database/redis";

export type SceneStatus = {
  sessionId: string;
  agentId: string;
  phase: "requested" | "waiting_entry" | "scene" | "exiting";
  ready: boolean;
};

/** 只传递用户准备请求与状态查询，不保存任务，也不重放断线期间的命令。 */
export const sceneRequestSchema = z.strictObject({
  id: z.uuid(),
  expiresAt: z.number(),
  command: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("prepare"),
      agentId: z.string().min(1),
      context: z.string().optional(),
    }),
    z.strictObject({
      type: z.literal("status"),
      agentId: z.string().min(1),
      sessionId: z.string().min(1),
    }),
  ]),
});
export type SceneRequest = z.infer<typeof sceneRequestSchema>;
export type SceneResponse = { ok: true; value: SceneStatus } | { ok: false; error: string };

export function sceneRequestChannel(characterId: string): string {
  return `${redisKeyPrefix()}character:${encodeURIComponent(characterId)}:scene-requests`;
}

/** 先订阅本次回执再发布；角色离线或十秒无回执直接失败，不自动重试。 */
export async function requestSceneCommand(
  characterId: string,
  command: SceneRequest["command"],
): Promise<SceneStatus> {
  const redis = await getRedis();
  const subscriber = redis.duplicate({
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 10_000,
    commandTimeout: 10_000,
  });
  const id = randomUUID();
  const replyChannel = `${sceneRequestChannel(characterId)}:${id}`;
  const expiresAt = Date.now() + 10_000;
  const signal = AbortSignal.timeout(10_000);
  let resolveReply!: (value: SceneResponse) => void;
  const reply = new Promise<SceneResponse>((resolve) => {
    resolveReply = resolve;
  });
  // 监听器同步注册；错误也作为正常回执进入同一等待点，避免未等待的拒绝。
  const fail = (error: unknown) => resolveReply({ ok: false, error: String(error) });
  subscriber.on("error", fail);
  subscriber.on("message", (_channel, message) => {
    try {
      resolveReply(JSON.parse(message) as SceneResponse);
    } catch (error) {
      fail(error);
    }
  });
  const abort = () => fail("角色场景请求超时，未自动重试，请确认角色运行状态");
  signal.addEventListener("abort", abort, { once: true });
  try {
    await subscriber.connect();
    await subscriber.subscribe(replyChannel);
    signal.throwIfAborted();
    const count = await redis.publish(
      sceneRequestChannel(characterId),
      JSON.stringify({
        id,
        expiresAt,
        command,
      } satisfies SceneRequest),
    );
    if (count === 0) {
      throw new Error("角色未连接场景请求通道，请确认 character-runtime 已运行主 agent");
    }
    const response = await reply;
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response.value;
  } finally {
    signal.removeEventListener("abort", abort);
    subscriber.disconnect();
  }
}
