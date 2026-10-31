import { load_config } from "@yuiju/shared/config/load";
import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { logger } from "@yuiju/shared/logger/logger";
import { getEnvironment } from "@yuiju/shared/utils/environment";
import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import type { WorldFact } from "./events";
import { archiveWorldFact, worldRetentionMs } from "./storage";
import { syncWorldFact } from "./sync";

/** 世界提交只入队；归档和通知分别消费，每个任务仅尝试一次，失败结束，不重新投递。 */
export class WorldEventQueues {
  readonly archive: Queue<WorldFact>;
  readonly notifications = new Map<string, Queue<WorldEvent>>();
  /** Worker 必须允许 Redis 重连等待，不能使用业务提交的快速失败连接。 */
  readonly workerConnection: Redis;
  private readonly archiveWorker: Worker<WorldFact>;

  constructor(producer: Redis, redisUrl: string, characterIds: Iterable<string>) {
    this.workerConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      // 长于 BullMQ 的正常阻塞等待，连接无响应时由 ioredis 断开重连。
      socketTimeout: 30_000,
    });
    this.workerConnection.on("error", (error) =>
      logger.error("世界队列 Redis 连接异常", { error }),
    );
    const options = {
      connection: producer,
      prefix: `${redisKeyPrefix()}world`,
      defaultJobOptions: {
        attempts: 1,
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
        try {
          if (job.data.occurredAt > Date.now() - worldRetentionMs) {
            await archiveWorldFact(job.data);
            if (
              getEnvironment() === "production" &&
              (await load_config()).database?.sync_mongo_uri
            ) {
              await syncWorldFact(job.data);
            }
            logger.silly("e2e.archive.completed", { jobId: job.id, eventId: job.data.eventId });
          }
        } catch (error) {
          // 已入队的旧任务可能仍带有重试次数；明确终止该任务，不沿用旧次数。
          throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
        }
      },
      {
        connection: this.workerConnection,
        prefix: options.prefix,
        // 进程中断导致锁丢失时也不重新执行归档。
        maxStalledCount: 0,
      },
    );
    this.archiveWorker.on("error", (error) => logger.error("世界归档 Worker 异常", { error }));
    this.archiveWorker.on("failed", (job, error) =>
      logger.error("世界事实归档失败，任务已终止，不再重试", { eventId: job?.data.eventId, error }),
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
