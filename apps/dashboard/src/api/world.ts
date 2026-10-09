import type { WorldEnvironmentStatus } from "@yuiju/shared/dashboard/types";
import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { Queue } from "bullmq";
import { Hono } from "hono";
import { getDeployment } from "@/lib/deployment";

type EventSummary = Pick<WorldEvent, "eventId" | "type" | "description" | "occurredAt">;
export type NotificationState = "waiting" | "active" | "delayed" | "failed";
export type WorldInteraction = {
  notifications: {
    state: NotificationState;
    total: number;
    events: (EventSummary & {
      failures: number;
      lastError: string | null;
      retryAt: number | null;
    })[];
  }[];
  received: {
    pendingCount: number;
    roundCount: number;
    events: (EventSummary & { inRound: boolean })[];
  };
  activity: { actionId: string; startedAt: number; endsAt: number | null } | null;
  activityWait: { endsAt: number; checkAt: number | null } | null;
};
export type WorldDashboardStatus = {
  readAt: number;
  environment: WorldEnvironmentStatus | null;
  interaction?: WorldInteraction;
};

/** 接收、轮次和活动等待只在私有部署读取；不把 LLM 上下文传到 Dashboard。 */
async function readWorldInteraction(characterId: string): Promise<WorldInteraction> {
  const redis = await getRedis();
  const prefix = redisKeyPrefix();
  const characterKey = `${prefix}character:${encodeURIComponent(characterId)}`;
  // 原子读取收件箱与轮次，避免完成轮次时的删除让同一事件被误判为下一轮输入。
  // 在 Redis 内只投影 round 的事件 ID，不传输可能很大的模型上下文。
  const [inbox, roundJson, waitJson, characterJson] = (await redis.eval(
    `
local roundIds = '[]'
local agent = redis.call('GET', KEYS[2])
if agent then
  local round = cjson.decode(agent).round
  if round ~= cjson.null and #round.worldEventIds > 0 then
    roundIds = cjson.encode(round.worldEventIds)
  end
end
return {
  redis.call('HVALS', KEYS[1]), roundIds,
  redis.call('GET', KEYS[3]), redis.call('HGET', KEYS[4], ARGV[1])
}
`,
    4,
    `${characterKey}:world-inbox`,
    `${characterKey}:agent:state`,
    `${characterKey}:agent:activity`,
    `${prefix}world:state`,
    `character:${characterId}`,
  )) as [string[], string, string | null, string | null];
  const roundIds = new Set<string>(JSON.parse(roundJson));
  const events = inbox.map((value) => {
    const { event } = JSON.parse(value) as { event: WorldEvent };
    return {
      eventId: event.eventId,
      type: event.type,
      description: event.description,
      occurredAt: event.occurredAt,
      inRound: roundIds.has(event.eventId),
    };
  });
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  const roundCount = events.filter((event) => event.inRound).length;
  const character = characterJson === null ? null : JSON.parse(characterJson);
  const activity = character?.currentActivity;
  const wait = waitJson === null ? null : JSON.parse(waitJson);

  // 只查询已有队列，跳过 Queue 初始化时的元数据写入。
  const queue = new Queue<WorldEvent>(`notify-${encodeURIComponent(characterId)}`, {
    connection: redis,
    prefix: `${prefix}world`,
    skipMetasUpdate: true,
  });
  queue.on("error", (error) => logger.error("读取世界通知队列失败", { error }));
  try {
    const states: NotificationState[] = ["waiting", "active", "delayed", "failed"];
    const counts = await queue.getJobCounts(...states);
    const notifications = await Promise.all(
      states.map(async (state) => {
        // 每种状态只取最早的 20 条，计数保持完整，避免积压拖慢首页。
        const jobs = await queue.getJobs(state, 0, 19, true);
        const entries = await Promise.all(
          jobs.map(async (job) => {
            // BullMQ 延迟分值的低 12 位用于排序；job.timestamp + delay 在重试后不准确。
            const score =
              state === "delayed" ? await redis.zscore(queue.toKey("delayed"), job.id!) : null;
            return {
              eventId: job.data.eventId,
              type: job.data.type,
              description: job.data.description,
              occurredAt: job.data.occurredAt,
              failures: job.attemptsMade,
              lastError: job.failedReason ? job.failedReason.slice(0, 500) : null,
              retryAt: score === null ? null : Math.floor(Number(score) / 4096),
            };
          }),
        );
        return { state, total: counts[state], events: entries };
      }),
    );
    return {
      notifications,
      received: {
        pendingCount: events.length - roundCount,
        roundCount,
        events: events.slice(0, 50),
      },
      activity:
        activity === null || activity === undefined
          ? null
          : {
              actionId: activity.actionId,
              startedAt: activity.startedAt,
              endsAt: activity.endsAt,
            },
      activityWait: wait === null ? null : { endsAt: wait.endsAt, checkAt: wait.checkAt },
    };
  } finally {
    // 关闭本次查询的 BullMQ 观察器，注入的共享 Redis 连接仍由 shared 管理。
    await queue.close();
  }
}

export const worldApi = new Hono().get("/", async (c) => {
  const deployment = await getDeployment();
  const value = await (await getRedis(deployment.source)).get(
    `${redisKeyPrefix()}dashboard:world:environment`,
  );
  const environment: WorldEnvironmentStatus | null = value === null ? null : JSON.parse(value);
  // 公开部署在这里结束，既不查询也不返回主库的角色交互信息。
  if (deployment.publicDeployment) {
    return c.json({ environment, readAt: Date.now() } satisfies WorldDashboardStatus);
  }
  const interaction = await readWorldInteraction(deployment.characterId);
  return c.json({ environment, interaction, readAt: Date.now() } satisfies WorldDashboardStatus);
});
