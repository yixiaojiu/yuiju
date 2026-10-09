import { on, once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { load_config } from "@yuiju/shared/config/load";
import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type {
  ExecuteActionInput,
  ExecuteActionResult,
  InspectWorldInput,
  InspectWorldResult,
  WorldEvent,
  WorldResult,
  WorldServerMessage,
} from "@yuiju/shared/world/protocol";
import { WebSocket } from "ws";
import { finishWorldActivityWait } from "../agent-loop/events";

const allEventTypes: WorldEvent["type"][] = [
  "activity_started",
  "activity_completed",
  "weather_changed",
  "idle_reminder",
];

/** 世界通知确认前，主 agent 模式持久入队，聊天调试模式直接同步状态。 */
export class WorldClient {
  readonly characterId: string;
  private readonly stopping = new AbortController();
  private connectionTask: Promise<void> | undefined;
  private socket: WebSocket | undefined;
  private eventTypes = allEventTypes;

  constructor(
    characterId: string,
    private readonly onReady: (
      current: Extract<InspectWorldResult, { type: "current" }>,
    ) => Promise<void>,
    private readonly onEvent: () => Promise<void>,
    private readonly options: { queueAgentEvents: boolean },
  ) {
    this.characterId = characterId;
  }

  async start(): Promise<void> {
    const config = await load_config();
    const baseUrl = config.app!.world_simulator!.base_url!;
    this.connectionTask = this.runConnection(baseUrl);
  }

  async stop(): Promise<void> {
    this.stopping.abort();
    this.socket?.terminate();
    await this.connectionTask;
  }

  /** 当前掌握控制权的 loop 决定订阅范围；角色地图可见性仍由世界计算。 */
  setEventTypes(eventTypes: WorldEvent["type"][]): void {
    this.eventTypes = [...eventTypes];
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.subscribe(this.socket);
    }
  }

  async inspect(query: InspectWorldInput): Promise<WorldResult<InspectWorldResult>> {
    const config = await load_config();

    const response = await fetch(new URL("/inspect", config.app!.world_simulator!.base_url!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: this.characterId, query }),
      signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(15_000)]),
    });
    const result = (await response.json()) as WorldResult<InspectWorldResult>;

    return result;
  }

  async execute(
    input: ExecuteActionInput,
    requestId: string,
  ): Promise<WorldResult<ExecuteActionResult>> {
    const config = await load_config();

    const response = await fetch(new URL("/actions", config.app!.world_simulator!.base_url!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: this.characterId, requestId, ...input }),
      signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(15_000)]),
    });
    const result = (await response.json()) as WorldResult<ExecuteActionResult>;

    return result;
  }

  private inboxKey(): string {
    return `${redisKeyPrefix()}character:${encodeURIComponent(this.characterId)}:world-inbox`;
  }

  private subscribe(socket: WebSocket): void {
    socket.send(
      JSON.stringify({
        type: "subscribe",
        characterId: this.characterId,
        eventTypes: this.eventTypes,
      }),
    );
  }

  private async runConnection(baseUrl: string): Promise<void> {
    const endpoint = new URL("/events", baseUrl);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    while (!this.stopping.signal.aborted) {
      const disconnected = new AbortController();
      const signal = AbortSignal.any([this.stopping.signal, disconnected.signal]);
      const socket = new WebSocket(endpoint);
      this.socket = socket;
      socket.once("close", () => disconnected.abort());
      socket.on("error", (error) => logger.warn("角色世界连接异常", { error }));
      try {
        await once(socket, "open", { signal });
        this.subscribe(socket);
        for await (const [data] of on(socket, "message", { signal })) {
          const message = JSON.parse(data.toString()) as WorldServerMessage;

          if (message.type === "error") {
            throw new Error(message.error.message);
          }
          if (message.type === "ready") {
            await this.onReady(message.current);
            continue;
          }
          logger.info("角色已接收世界通知", {
            type: message.event.type,
            description: message.event.description,
          });
          if (this.options.queueAgentEvents) {
            if (message.event.type === "activity_completed" && message.event.activity) {
              // 接收时撤销对应等待与未处理的超时输入，不等主 loop 完成当前思考。
              await finishWorldActivityWait(this.characterId, message.event.activity.activityId);
            }
            await this.storeEvent(message.deliveryId, message.event);
          }
          // 聊天模式同步成功后才确认；主 agent 这里只唤醒，不等待模型执行。
          await this.onEvent();
          socket.send(JSON.stringify({ type: "ack", deliveryId: message.deliveryId }));
        }
      } catch (error) {
        if (!this.stopping.signal.aborted) {
          logger.warn("角色世界连接中断，等待重新连接", { error });
        }
      } finally {
        socket.terminate();
        this.socket = undefined;
      }
      try {
        await setTimeout(1_000, undefined, { signal: this.stopping.signal });
      } catch (error) {
        if (!this.stopping.signal.aborted) {
          throw error;
        }
      }
    }
  }

  /** 去重标识与输入队列原子保存，消费后的事件也不会因 WS 重发再次入队。 */
  private async storeEvent(deliveryId: string, event: WorldEvent): Promise<void> {
    const redis = await getRedis();
    const seen = `${this.inboxKey()}:received:${event.eventId}`;
    await redis.eval(
      `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'PXAT', ARGV[3])
return 1
`,
      2,
      this.inboxKey(),
      seen,
      event.eventId,
      JSON.stringify({ deliveryId, event }),
      event.occurredAt + 30 * 24 * 60 * 60_000,
    );
  }
}
