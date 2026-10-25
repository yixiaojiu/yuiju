import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { logger } from "@yuiju/shared/logger/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import type { ClientMessage, ScenePreparation, ServerMessage } from "../protocol.ts";
import { InteractionConnection } from "./connection.ts";

const preparation: ScenePreparation = {
  persona: "test",
  scenePrompt: "test",
  sceneContent: "",
  scenePresets: [],
  characterPrompt: "test",
  context: "",
  enabledTools: ["street_view"],
  simulateSpeech: true,
};
const screen = {
  image: "test-image",
  orientation: { heading: 135, direction: "东南", pitch: 15 },
  width: 100,
  height: 100,
  title: "Maps",
  url: "https://www.google.com/maps",
};

// 通过真实本地 WebSocket 验证协议、身份及状态约束，不创建模型或连接浏览器。
describe("浏览器工具测试入口", () => {
  let connection: InteractionConnection;
  let controller: AbortController;
  let entry: Promise<unknown>;
  let url: string;
  const receive = vi.fn();
  const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const peers: WebSocket[] = [];

  async function peer(role: "page" | "browser") {
    const socket = new WebSocket(url);
    peers.push(socket);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await once(socket, "open");
    const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
    send({ type: "hello", role, token: "test-token" });
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === "status")).toBe(true),
    );
    async function next<T extends ServerMessage["type"]>(type: T, id?: string) {
      let found: Extract<ServerMessage, { type: T }> | undefined;
      await vi.waitFor(() => {
        found = messages.find(
          (message) =>
            message.type === type && (id === undefined || ("id" in message && message.id === id)),
        ) as typeof found;
        expect(found).toBeDefined();
      });
      return found!;
    }
    return { socket, send, messages, next };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    controller = new AbortController();
    connection = new InteractionConnection(
      { url: "ws://127.0.0.1:0", token: "test-token" },
      receive,
      log as unknown as typeof logger,
    );
    let ready!: () => void;
    const listening = new Promise<void>((resolve) => {
      ready = resolve;
    });
    entry = connection
      .waitForEntry(preparation, controller.signal, ready)
      .catch((error: unknown) => error);
    await Promise.race([
      listening,
      entry.then((error) => {
        throw error;
      }),
    ]);
    // 测试使用系统分配的空闲端口，不增加生产配置。
    const server = Reflect.get(connection, "server") as WebSocketServer;
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    controller.abort();
    await connection.close();
    await entry;
    for (const socket of peers.splice(0)) {
      socket.terminate();
    }
  });

  it("复用正式 request，关联阶段日志和截图，不投递 agent 输入", async () => {
    const page = await peer("page");
    const browser = await peer("browser");
    const id = randomUUID();
    page.send({
      type: "browser_test",
      id,
      command: { method: "street_view", input: { type: "move", direction: "forward" } },
    });
    expect(await browser.next("request", id)).toMatchObject({
      id,
      method: "street_view",
      input: { type: "move", direction: "forward" },
    });
    browser.send({
      type: "browser_progress",
      id,
      stage: "等待街景画面稳定",
      state: "completed",
      durationMs: 528,
    });
    expect(await page.next("browser_progress", id)).toMatchObject({ durationMs: 528 });
    browser.send({ type: "result", id, result: { ok: true, value: screen } });
    expect(await page.next("browser_test_result", id)).toMatchObject({
      result: { ok: true, screen },
    });
    expect(receive).not.toHaveBeenCalled();
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(screen.image);
    expect(log.info).toHaveBeenCalledWith(
      "互动浏览器操作阶段",
      expect.objectContaining({ id, stage: "等待街景画面稳定" }),
    );
  });

  it("测试未结束时拒绝进入和第二次测试，失败后释放占用", async () => {
    const page = await peer("page");
    const browser = await peer("browser");
    const id = randomUUID();
    const command = { method: "observe", input: {} } as const;
    page.send({ type: "browser_test", id, command });
    await browser.next("request", id);
    page.send({ type: "enter", ...preparation });
    expect(await page.next("error")).toMatchObject({
      message: expect.stringContaining("测试正在执行"),
    });
    const second = randomUUID();
    page.send({ type: "browser_test", id: second, command });
    expect(await page.next("browser_test_result", second)).toMatchObject({
      result: { ok: false, error: expect.stringContaining("正在执行") },
    });
    browser.send({ type: "result", id, result: { ok: false, error: "图片加载失败" } });
    expect(await page.next("browser_test_result", id)).toMatchObject({
      result: { ok: false, error: expect.stringContaining("图片加载失败") },
    });
    page.send({ type: "enter", ...preparation });
    expect(await entry).toMatchObject({ type: "enter" });
    connection.start();
    const third = randomUUID();
    page.send({ type: "browser_test", id: third, command });
    expect(await page.next("browser_test_result", third)).toMatchObject({
      result: { ok: false, error: expect.stringContaining("准备阶段") },
    });
    expect(browser.messages.filter((message) => message.type === "request")).toHaveLength(1);
  });

  it("控制页断开时取消在途测试", async () => {
    const page = await peer("page");
    const browser = await peer("browser");
    const id = randomUUID();
    page.send({ type: "browser_test", id, command: { method: "observe", input: {} } });
    await browser.next("request", id);
    page.socket.close();
    expect(await browser.next("cancel", id)).toMatchObject({ id });
    expect(receive).not.toHaveBeenCalled();
  });

  it("无浏览器时明确返回失败，错误参数不下发", async () => {
    const page = await peer("page");
    const id = randomUUID();
    page.send({ type: "browser_test", id, command: { method: "observe", input: {} } });
    expect(await page.next("browser_test_result", id)).toMatchObject({
      result: { ok: false, error: expect.stringContaining("browser 未连接") },
    });
    const browser = await peer("browser");
    page.socket.send(
      JSON.stringify({
        type: "browser_test",
        id: randomUUID(),
        command: { method: "street_view", input: { type: "move", direction: "invalid" } },
      }),
    );
    await page.next("error");
    expect(browser.messages.filter((message) => message.type === "request")).toHaveLength(0);
  });
});
