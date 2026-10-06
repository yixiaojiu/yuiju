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
];

/** 与角色实例绑定的世界连接；事件先保存到 Redis 输入队列，再向世界确认。 */
export class WorldClient {
  readonly characterId: string;
  private readonly stopping = new AbortController();
  private connectionTask: Promise<void> | undefined;
  private socket: WebSocket | undefined;
  private eventTypes = allEventTypes;

  constructor(
    characterId: string,
    private readonly onReady: () => Promise<void>,
    private readonly onEvent: () => void,
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
    logger.silly("e2e.world.inspect.request", { characterId: this.characterId, query });
    const response = await fetch(new URL("/inspect", config.app!.world_simulator!.base_url!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: this.characterId, query }),
      signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(15_000)]),
    });
    const result = (await response.json()) as WorldResult<InspectWorldResult>;
    logger.silly("e2e.world.inspect.response", { characterId: this.characterId, result });
    return result;
  }

  async execute(
    input: ExecuteActionInput,
    requestId: string,
  ): Promise<WorldResult<ExecuteActionResult>> {
    const config = await load_config();
    logger.silly("e2e.world.action.request", { characterId: this.characterId, requestId, input });
    const response = await fetch(new URL("/actions", config.app!.world_simulator!.base_url!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: this.characterId, requestId, ...input }),
      signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(15_000)]),
    });
    const result = (await response.json()) as WorldResult<ExecuteActionResult>;
    logger.silly("e2e.world.action.response", { characterId: this.characterId, requestId, result });
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
      socket.on("error", (error) =>
        logger.warn("角色世界连接异常", { characterId: this.characterId, error }),
      );
      try {
        await once(socket, "open", { signal });
        this.subscribe(socket);
        for await (const [data] of on(socket, "message", { signal })) {
          const message = JSON.parse(data.toString()) as WorldServerMessage;
          logger.silly("e2e.world.ws.received", {
            characterId: this.characterId,
            payload: message,
          });
          if (message.type === "error") {
            throw new Error(message.error.message);
          }
          if (message.type === "ready") {
            logger.info("角色已连接世界", { characterId: this.characterId });
            await this.onReady();
            continue;
          }
          if (message.event.type === "activity_completed" && message.event.activity) {
            // 接收时撤销对应等待与未处理的超时输入，不等主 loop 完成当前思考。
            await finishWorldActivityWait(this.characterId, message.event.activity.activityId);
          }
          await this.storeEvent(message.deliveryId, message.event);
          logger.silly("e2e.world.event.saved", {
            characterId: this.characterId,
            deliveryId: message.deliveryId,
            event: message.event,
          });
          socket.send(JSON.stringify({ type: "ack", deliveryId: message.deliveryId }));
          logger.silly("e2e.world.event.ack.sent", {
            characterId: this.characterId,
            deliveryId: message.deliveryId,
          });
          this.onEvent();
        }
      } catch (error) {
        if (!this.stopping.signal.aborted) {
          logger.warn("角色世界连接中断，等待重新连接", { characterId: this.characterId, error });
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
