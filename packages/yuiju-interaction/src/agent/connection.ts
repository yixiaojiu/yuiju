import { randomUUID, timingSafeEqual } from "node:crypto";
import type { logger } from "@yuiju/shared/logger/logger";
import { WebSocket, WebSocketServer } from "ws";
import type { InteractionConfig } from "../config.ts";
import {
  type BrowserTestCommand,
  clientMessageSchema,
  type InputEvent,
  type Live2DFrame,
  type SceneEntry,
  type ScenePreparation,
  type ServerMessage,
  screenSchema,
  streetViewScreenSchema,
} from "../protocol.ts";

type Peer = "page" | "browser";
type PendingRequest = {
  peer: WebSocket;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

/** 一个场景拥有一组连接；回执只交给原请求，普通输入由宿主排队。 */
export class InteractionConnection {
  private server?: WebSocketServer;
  private peers = new Map<Peer, WebSocket>();
  /** 只读展示端不占用控制页身份；关闭展示页不结束互动。 */
  private observers = new Set<WebSocket>();
  private latestFrame?: Live2DFrame;
  private subtitle = "";
  private requests = new Map<string, PendingRequest>();
  private enter?: (entry: SceneEntry) => void;
  private rejectEntry?: (error: Error) => void;
  private phase = "waiting_entry";
  private browserTest?: AbortController;

  constructor(
    private readonly config: InteractionConfig["connection"],
    private readonly receive: (event: InputEvent) => void,
    private readonly log: typeof logger,
  ) {}

  async waitForEntry(
    preparation: ScenePreparation,
    signal: AbortSignal,
    ready: () => void,
  ): Promise<SceneEntry> {
    const url = new URL(this.config.url);
    const server = new WebSocketServer({
      host: url.hostname,
      port: Number(url.port),
      maxPayload: 8 * 1024 * 1024,
    });
    this.server = server;
    const abort = () => this.rejectEntry?.(new Error("场景进入已取消"));
    try {
      return await new Promise<SceneEntry>((resolve, reject) => {
        this.enter = resolve;
        this.rejectEntry = reject;
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
        }
        server.on("error", reject);
        server.once("listening", ready);
        server.on("connection", (socket) => this.accept(socket, preparation));
      });
    } finally {
      signal.removeEventListener("abort", abort);
      this.enter = undefined;
      this.rejectEntry = undefined;
    }
  }

  private accept(socket: WebSocket, preparation: ScenePreparation) {
    let role: Peer | "observer" | undefined;
    const timer = setTimeout(() => socket.close(1008, "认证超时"), 5000);
    socket.on("error", (error) => {
      this.log.warn("互动客户端连接错误", { role, error });
      socket.close();
    });
    socket.on("message", async (data) => {
      try {
        const message = clientMessageSchema.parse(JSON.parse(data.toString()));
        if (!role) {
          if (message.type !== "hello") {
            throw new Error("请先认证连接");
          }
          const supplied = Buffer.from(message.token);
          const expected = Buffer.from(this.config.token);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            socket.close(1008, "认证失败");
            return;
          }
          if (message.role !== "observer" && this.peers.has(message.role)) {
            socket.close(1008, "该客户端已连接");
            return;
          }
          role = message.role;
          this.log.info("互动客户端已连接", { role });
          clearTimeout(timer);
          if (role === "observer") {
            this.observers.add(socket);
            if (this.latestFrame) {
              this.send(socket, { type: "live2d_frame", frame: this.latestFrame });
            }
            this.send(socket, { type: "subtitle", text: this.subtitle });
            return;
          }
          this.peers.set(role, socket);
          if (role === "page" && this.phase === "waiting_entry") {
            this.send(socket, { type: "preparation", preparation });
          }
          this.status();
          return;
        }
        if (message.type === "ping") {
          return;
        }
        if (role === "observer") {
          throw new Error("展示页连接只允许接收展示状态");
        }
        if (message.type === "result") {
          const pending = this.requests.get(message.id);
          // 用户取消后浏览器可能仍返回结果；该回执已经失效，不执行任何操作。
          if (pending?.peer === socket) {
            this.requests.delete(message.id);
            if (message.result.ok) {
              pending.resolve(message.result.value);
            } else {
              pending.reject(new Error(message.result.error));
            }
          }
          return;
        }
        if (message.type === "browser_progress") {
          if (role !== "browser") {
            throw new Error("只有浏览器扩展能上报操作阶段");
          }
          // 已取消请求的迟到日志不再参与本次诊断。
          if (this.requests.get(message.id)?.peer === socket) {
            this.log.info("互动浏览器操作阶段", message);
            this.notify(message);
          }
          return;
        }
        if (role !== "page") {
          throw new Error("浏览器控制端只能返回操作结果");
        }
        if (message.type === "live2d_frame") {
          this.latestFrame = message.frame;
          for (const observer of this.observers) {
            this.send(observer, message);
          }
          return;
        }
        if (message.type === "subtitle") {
          this.subtitle = message.text;
          for (const observer of this.observers) {
            this.send(observer, message);
          }
          return;
        }
        if (message.type === "browser_test") {
          await this.testBrowser(socket, message.id, message.command);
          return;
        }
        if (message.type === "enter") {
          if (this.browserTest) {
            throw new Error("浏览器工具测试正在执行，请等待结束后再进入场景");
          }
          if (this.phase !== "waiting_entry" || !this.enter || !this.peers.has("browser")) {
            throw new Error("场景未准备好或尚未连接目标标签页");
          }
          this.phase = "entering";
          this.enter(message);
          this.status();
          return;
        }
        if (message.type === "event") {
          if (this.phase !== "running") {
            throw new Error("场景尚未运行");
          }
          this.receive(message.event);
        }
      } catch (error) {
        this.log.warn("互动客户端消息处理失败", { role, error });
        this.send(socket, { type: "error", message: String(error) });
      }
    });
    socket.on("close", (code, reason) => {
      this.log.info("互动客户端已断开", {
        role,
        code,
        reason: reason.toString(),
        phase: this.phase,
      });
      clearTimeout(timer);
      if (role === "observer") {
        this.observers.delete(socket);
        return;
      }
      if (!role || this.peers.get(role) !== socket) {
        return;
      }
      this.peers.delete(role);
      if (role === "page") {
        this.browserTest?.abort(new Error("调试页面已断开"));
        this.subtitle = "";
        for (const observer of this.observers) {
          this.send(observer, { type: "subtitle", text: "" });
        }
      }
      for (const [id, pending] of this.requests) {
        if (pending.peer === socket) {
          this.requests.delete(id);
          pending.reject(new Error(`${role} 已断开`));
        }
      }
      if (this.phase === "running") {
        this.receive({ type: "exit", reason: `${role} 连接断开` });
      } else if (this.phase !== "closed") {
        this.rejectEntry?.(new Error(`${role} 在进入前断开`));
      }
      this.status();
    });
  }

  /** 准备阶段直接走正式浏览器请求链，不生成模型请求或观察事件。 */
  private async testBrowser(socket: WebSocket, id: string, command: BrowserTestCommand) {
    const startedAt = Date.now();
    const controller = new AbortController();
    try {
      if (this.phase !== "waiting_entry") {
        throw new Error("只能在准备阶段测试浏览器工具");
      }
      if (this.browserTest) {
        throw new Error("已有浏览器工具测试正在执行");
      }
      this.browserTest = controller;
      const screen = (
        command.method === "street_view" ? streetViewScreenSchema : screenSchema
      ).parse(await this.request("browser", command.method, command.input, controller.signal, id));
      this.send(socket, {
        type: "browser_test_result",
        id,
        durationMs: Date.now() - startedAt,
        result: { ok: true, screen },
      });
    } catch (error) {
      this.send(socket, {
        type: "browser_test_result",
        id,
        durationMs: Date.now() - startedAt,
        result: { ok: false, error: String(error) },
      });
    } finally {
      if (this.browserTest === controller) {
        this.browserTest = undefined;
      }
    }
  }

  start() {
    if (!this.peers.has("page") || !this.peers.has("browser")) {
      throw new Error("场景客户端已断开");
    }
    this.phase = "running";
    this.status();
  }

  private status() {
    for (const socket of this.peers.values()) {
      this.send(socket, {
        type: "status",
        phase: this.phase,
        browserConnected: this.peers.has("browser"),
      });
    }
  }

  notify(event: ServerMessage) {
    const socket = this.peers.get("page");
    if (socket) {
      this.send(socket, event);
    }
  }

  private send(socket: WebSocket, event: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  async request(
    peer: Peer,
    method: "observe" | "action" | "street_view" | "perform",
    input: unknown,
    signal: AbortSignal,
    id: string = randomUUID(),
  ): Promise<unknown> {
    signal.throwIfAborted();
    const socket = this.peers.get(peer);
    if (!socket) {
      throw new Error(`${peer} 未连接`);
    }
    const startedAt = Date.now();
    this.log.debug("互动发送客户端请求", { id, peer, method });
    const timeout = AbortSignal.timeout(30_000);
    const cancellation = AbortSignal.any([signal, timeout]);
    let abort!: () => void;
    try {
      const result = await new Promise((resolve, reject) => {
        abort = () => {
          this.requests.delete(id);
          this.send(socket, { type: "cancel", id });
          reject(cancellation.reason);
        };
        this.requests.set(id, { peer: socket, resolve, reject });
        cancellation.addEventListener("abort", abort, { once: true });
        this.send(socket, { type: "request", id, method, input });
      });
      this.log.debug("互动客户端请求完成", {
        id,
        peer,
        method,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.log.warn("互动客户端请求未完成", {
        id,
        peer,
        method,
        durationMs: Date.now() - startedAt,
        cancelled: signal.aborted,
        timedOut: timeout.aborted,
        error,
      });
      throw error;
    } finally {
      cancellation.removeEventListener("abort", abort);
      this.requests.delete(id);
    }
  }

  async close() {
    this.browserTest?.abort(new Error("场景已关闭"));
    this.phase = "closed";
    this.status();
    for (const request of this.requests.values()) {
      request.reject(new Error("场景已关闭"));
    }
    this.requests.clear();
    for (const socket of this.server?.clients ?? []) {
      socket.terminate();
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.peers.clear();
    this.observers.clear();
    this.latestFrame = undefined;
    this.subtitle = "";
  }
}
