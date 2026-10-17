import { EventEmitter, on, once } from "node:events";
import type { Server } from "node:http";
import { logger } from "@yuiju/shared/logger/logger";
import {
  type WorldEvent,
  type WorldServerMessage,
  worldClientMessageSchema,
} from "@yuiju/shared/world/protocol";
import { UnrecoverableError, Worker } from "bullmq";
import { WebSocket, WebSocketServer } from "ws";
import type { WorldEventQueues } from "../queue";
import { worldRetentionMs } from "../storage";
import type { World } from "../world";

type Subscription = {
  socket: WebSocket;
  signal: AbortSignal;
  eventTypes: Set<WorldEvent["type"]>;
  /** 每个 deliveryId 独立唤醒对应任务，不维护连续确认位置。 */
  acknowledgements: EventEmitter;
};

/** WS 负责连接与确认；BullMQ 保存离线积压；每条通知连接后只尝试投递一次。 */
export function attachWorldWebSocket(server: Server, world: World, queues: WorldEventQueues) {
  const sockets = new WebSocketServer({ server, path: "/events" });
  sockets.on("error", (error) => logger.error("世界 WebSocket 服务异常", { error }));
  const connections = new Map<WebSocket, Promise<void>>();
  const subscriptions = new Map<string, Subscription>();
  // 离线时不消费通知，订阅后启动 Worker；断线暂停取新任务，在途任务失败即结束。
  const workers = new Map(
    [...queues.notifications].map(([characterId, queue]) => {
      const worker = new Worker<WorldEvent>(
        queue.name,
        async (job) => {
          try {
            if (job.data.occurredAt <= Date.now() - worldRetentionMs) {
              return;
            }
            const subscription = subscriptions.get(characterId);
            if (!subscription || subscription.signal.aborted) {
              throw new Error("角色已断开，本次投递取消");
            }
            if (!subscription.eventTypes.has(job.data.type)) {
              // 场景主动过滤的通知直接完成，切回场景后不再补发。
              return;
            }
            const signal = AbortSignal.any([subscription.signal, AbortSignal.timeout(30_000)]);
            const acknowledged = once(subscription.acknowledgements, job.id!, { signal });
            send(subscription.socket, { type: "event", deliveryId: job.id!, event: job.data });
            logger.info("世界通知已发出，等待确认", {
              characterId,
              deliveryId: job.id,
              eventId: job.data.eventId,
              type: job.data.type,
              attempt: job.attemptsMade + 1,
            });
            logger.silly("e2e.notification.sent", { characterId, jobId: job.id, event: job.data });
            // 仅当前任务等 ACK，其他任务继续发送；超时或断线终止本次投递。
            await acknowledged;
            logger.info("世界通知已确认接收", {
              characterId,
              deliveryId: job.id,
              eventId: job.data.eventId,
            });
            logger.silly("e2e.notification.acknowledged", {
              characterId,
              jobId: job.id,
              eventId: job.data.eventId,
            });
          } catch (error) {
            throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
          }
        },
        {
          autorun: false,
          connection: queues.workerConnection,
          prefix: queue.opts.prefix,
          concurrency: 32,
          maxStalledCount: 0,
        },
      );
      worker.on("error", (error) => logger.error("世界通知 Worker 异常", { characterId, error }));
      worker.on("failed", (job, error) =>
        logger.warn("世界通知未确认，任务已终止，不再重试", {
          characterId,
          eventId: job?.data.eventId,
          error,
        }),
      );
      return [characterId, worker];
    }),
  );

  sockets.on("connection", async (socket) => {
    const task = handleConnection(socket);
    connections.set(socket, task);
    try {
      await task;
    } catch (error) {
      logger.error("世界事件连接清理失败", { error });
    } finally {
      connections.delete(socket);
    }
  });

  async function handleConnection(socket: WebSocket): Promise<void> {
    const stopping = new AbortController();
    const signal = stopping.signal;
    let characterId: string | undefined;
    socket.once("close", () => stopping.abort());
    socket.on("error", (error) => {
      logger.warn("世界事件连接异常", { error });
      stopping.abort();
    });
    try {
      for await (const [data] of on(socket, "message", { signal })) {
        const message = worldClientMessageSchema.parse(JSON.parse(data.toString()));
        if (message.type === "ack") {
          if (characterId === undefined) {
            throw new Error("必须先订阅角色事件，再确认通知");
          }
          // 迟到或重复 ACK 没有等待者时无副作用；不能删除尚未发送的任务。
          subscriptions.get(characterId)!.acknowledgements.emit(message.deliveryId);
          continue;
        }
        if (characterId !== undefined) {
          if (characterId !== message.characterId) {
            throw new Error("同一连接不能切换角色身份");
          }
          subscriptions.get(characterId)!.eventTypes = new Set(message.eventTypes);
          continue;
        }
        const current = world.inspect(message.characterId, { type: "current" });
        if (!current.ok) {
          send(socket, { type: "error", error: current });
          break;
        }
        if (current.value.type !== "current") {
          throw new Error("当前世界查询返回了错误的响应类型");
        }
        // 角色只保留一个连接；旧连接关闭会释放其所有在途 ACK 等待。
        while (subscriptions.has(message.characterId)) {
          const previous = subscriptions.get(message.characterId)!;
          previous.socket.terminate();
          await connections.get(previous.socket);
        }
        signal.throwIfAborted();
        characterId = message.characterId;
        subscriptions.set(characterId, {
          socket,
          signal,
          eventTypes: new Set(message.eventTypes),
          // 多条在途通知各自监听 ACK；数量受 Worker concurrency 限制。
          acknowledgements: new EventEmitter().setMaxListeners(0),
        });
        send(socket, { type: "ready", current: current.value });
        await workers.get(characterId)!.resume();
        logger.info("角色已订阅世界事件", { characterId, eventTypes: message.eventTypes });
      }
    } catch (error) {
      if (!signal.aborted) {
        logger.warn("世界事件订阅失败", { error });
        if (socket.readyState === WebSocket.OPEN) {
          send(socket, {
            type: "error",
            error: { ok: false, code: "invalid_request", message: "事件订阅或确认失败" },
          });
        }
      }
    } finally {
      stopping.abort();
      socket.close();
      if (characterId !== undefined) {
        await workers.get(characterId)!.pause(true);
        subscriptions.delete(characterId);
        logger.info("角色世界订阅已断开", { characterId });
      }
    }
  }

  return {
    async stop(): Promise<void> {
      for (const socket of sockets.clients) {
        socket.terminate();
      }
      await Promise.all(connections.values());
      await Promise.all([...workers.values()].map((worker) => worker.close()));
      await new Promise<void>((resolve, reject) =>
        sockets.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function send(socket: WebSocket, message: WorldServerMessage): void {
  socket.send(JSON.stringify(message));
}
