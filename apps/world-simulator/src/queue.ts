import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { logger } from "@yuiju/shared/logger/logger";
import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import type { WorldFact } from "./events";
import { archiveWorldFact, worldRetentionMs } from "./storage";

/** 世界提交只入队；归档和通知分别消费，失败每 5 秒重试，最长保留 30 天。 */
export class WorldEventQueues {
  readonly archive: Queue<WorldFact>;
  readonly notifications = new Map<string, Queue<WorldEvent>>();
  /** Worker 必须允许 Redis 重连等待，不能使用业务提交的快速失败连接。 */
  readonly workerConnection: Redis;
  private readonly archiveWorker: Worker<WorldFact>;

  constructor(producer: Redis, redisUrl: string, characterIds: Iterable<string>) {
    this.workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.workerConnection.on("error", (error) =>
      logger.error("世界队列 Redis 连接异常", { error }),
    );
    const options = {
      connection: producer,
      prefix: `${redisKeyPrefix()}world`,
      defaultJobOptions: {
        // 每次重试至少间隔 5 秒，次数覆盖整个保留期；消费时仍按 occurredAt 判断过期。
        attempts: Math.ceil(worldRetentionMs / 5_000) + 1,
        backoff: { type: "fixed", delay: 5_000 },
        removeOnComplete: true,
        // 最终失败后保留 30 天；由 BullMQ 后续失败任务触发清理，不是 Redis TTL。
        removeOnFail: { age: worldRetentionMs / 1_000 },
      },
    };
    this.archive = new Queue<WorldFact>("archive", options);
    for (const characterId of characterIds) {
      this.notifications.set(
        characterId,
        new Queue<WorldEvent>(`notify-${encodeURIComponent(characterId)}`, options),
      );
    }
    for (const queue of [this.archive, ...this.notifications.values()]) {
      queue.on("error", (error) => logger.error("世界事件队列异常", { queue: queue.name, error }));
    }
    this.archiveWorker = new Worker<WorldFact>(
      this.archive.name,
      async (job) => {
        if (job.data.occurredAt > Date.now() - worldRetentionMs) {
          await archiveWorldFact(job.data);
          logger.silly("e2e.archive.completed", { jobId: job.id, eventId: job.data.eventId });
        }
      },
      {
        connection: this.workerConnection,
        prefix: options.prefix,
        // 崩溃重启不耗尽任务；保留期限由事件自身的 occurredAt 决定。
        maxStalledCount: Number.MAX_SAFE_INTEGER,
      },
    );
    this.archiveWorker.on("error", (error) => logger.error("世界归档 Worker 异常", { error }));
    this.archiveWorker.on("failed", (job, error) =>
      logger.error("世界事实归档失败，队列将重试", { eventId: job?.data.eventId, error }),
    );
  }

  /** 入队脚本在提交 Redis 事务前完成注册。 */
  async start(): Promise<void> {
    await Promise.all([
      this.archive.waitUntilReady(),
      this.archiveWorker.waitUntilReady(),
      ...[...this.notifications.values()].map((queue) => queue.waitUntilReady()),
    ]);
  }

  /** 通知 Worker 由 WS 模块先关闭；此处再停止归档与生产端。 */
  async stop(): Promise<void> {
    await this.archiveWorker.close();
    await Promise.all([
      this.archive.close(),
      ...[...this.notifications.values()].map((queue) => queue.close()),
    ]);
    this.workerConnection.disconnect();
  }
}
