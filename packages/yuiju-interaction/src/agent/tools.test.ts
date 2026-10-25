import { expect, it, vi } from "vitest";
import type { InteractionConnection } from "./connection.ts";
import { createInteractionTools } from "./tools.ts";

it("模型可见回执保留实际视角，图片仍单独投递为观察事件", async () => {
  const screen = {
    image: "test-image",
    width: 100,
    height: 100,
    title: "Maps",
    url: "https://google.com/maps",
    orientation: { heading: 135, direction: "东南", pitch: 15 },
  };
  const request = vi.fn(async () => screen);
  const observe = vi.fn();
  const tools = createInteractionTools(
    { request, notify: vi.fn() } as unknown as InteractionConnection,
    new Map(),
    new AbortController().signal,
    {},
    observe,
  );
  const result = await tools.street_view.execute!(
    { type: "look", direction: "right", angle: 90 },
    { toolCallId: "look-test", messages: [], context: {} },
  );
  expect(result).toMatchObject({ ok: true, screen: { orientation: screen.orientation } });
  expect(JSON.stringify(result)).not.toContain(screen.image);
  expect(observe).toHaveBeenCalledWith({
    type: "observation",
    toolName: "street_view",
    toolCallId: "look-test",
    screen,
  });
});

const streetScreen = {
  image: "street-image",
  width: 100,
  height: 100,
  title: "Maps",
  url: "https://google.com/maps",
  orientation: { heading: 90, direction: "东", pitch: 0 },
};
const options = { toolCallId: "test", messages: [], context: {} };

it.each(["forward", "backward"] as const)(
  "台本未结束时拒绝 %s，完成后不会自动重放移动",
  async (direction) => {
    const performances = new Map([["speech", "看这座建筑"]]);
    const request = vi.fn(async () => streetScreen);
    const notify = vi.fn();
    const observe = vi.fn();
    const tools = createInteractionTools(
      { request, notify } as unknown as InteractionConnection,
      performances,
      new AbortController().signal,
      {},
      observe,
    );
    expect(await tools.street_view.execute!({ type: "move", direction }, options)).toMatchObject({
      status: "busy",
    });
    expect(request).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();

    performances.delete("speech");
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(await tools.street_view.execute!({ type: "move", direction }, options)).toMatchObject({
      ok: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { type: "observe" },
  { type: "look", direction: "left", angle: 90 },
  { type: "look", direction: "right", angle: 90 },
  { type: "look", direction: "up", angle: 45 },
  { type: "look", direction: "down", angle: 45 },
  { type: "zoom", direction: "in" },
  { type: "zoom", direction: "out" },
] as const)("台本未结束时仍可执行 $type $direction", async (input) => {
  const performances = new Map([["speech", "看看四周"]]);
  const request = vi.fn(async () => streetScreen);
  const observe = vi.fn();
  const tools = createInteractionTools(
    { request, notify: vi.fn() } as unknown as InteractionConnection,
    performances,
    new AbortController().signal,
    {},
    observe,
  );
  expect(await tools.street_view.execute!(input, options)).toMatchObject({ ok: true });
  expect(request).toHaveBeenCalledWith("browser", "street_view", input, expect.any(AbortSignal));
  expect(observe).toHaveBeenCalledTimes(1);
  expect(performances.get("speech")).toBe("看看四周");
});

it("先提交台本时，入队请求尚未返回及返回后都禁止移动，下一轮也保持限制", async () => {
  let acknowledge!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const connection = { request, notify: vi.fn() } as unknown as InteractionConnection;
  const performances = new Map<string, string>();
  const signal = new AbortController().signal;
  const decision = {};
  const tools = createInteractionTools(connection, performances, signal, decision, vi.fn());
  const speech = tools.vtuber_act.execute!({ script: "看看这里" }, options);
  expect(
    await tools.street_view.execute!({ type: "move", direction: "forward" }, options),
  ).toMatchObject({ status: "busy" });
  acknowledge({});
  expect(await speech).toMatchObject({ status: "queued" });
  expect(decision).toEqual({ performanceQueued: true });
  const nextRoundTools = createInteractionTools(connection, performances, signal, {}, vi.fn());
  expect(
    await nextRoundTools.street_view.execute!({ type: "move", direction: "forward" }, options),
  ).toMatchObject({ status: "busy" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "page",
    "perform",
    { script: "看看这里", toolCallId: "test" },
    signal,
  );
});

it.each(["success", "failure"])(
  "先移动时拒绝台本和重复移动，移动 %s 后允许提交台本",
  async (outcome) => {
    let complete!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    const request = vi
      .fn(async (): Promise<unknown> => ({}))
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            complete = resolve;
            fail = reject;
          }),
      );
    const performances = new Map<string, string>();
    const tools = createInteractionTools(
      { request, notify: vi.fn() } as unknown as InteractionConnection,
      performances,
      new AbortController().signal,
      {},
      vi.fn(),
    );
    const move = tools.street_view.execute!({ type: "move", direction: "forward" }, options);
    expect(await tools.vtuber_act.execute!({ script: "看看这里" }, options)).toMatchObject({
      status: "busy",
    });
    expect(
      await tools.street_view.execute!({ type: "move", direction: "backward" }, options),
    ).toMatchObject({ status: "busy" });
    expect(performances.size).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    if (outcome === "success") {
      complete(streetScreen);
      expect(await move).toMatchObject({ ok: true });
    } else {
      fail(new Error("移动失败"));
      expect(await move).toMatchObject({ ok: false, error: "Error: 移动失败" });
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect(await tools.vtuber_act.execute!({ script: "看看这里" }, options)).toMatchObject({
      status: "queued",
    });
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it("台本提交失败后释放移动限制", async () => {
  const request = vi.fn(async () => streetScreen).mockRejectedValueOnce(new Error("提交失败"));
  const performances = new Map<string, string>();
  const tools = createInteractionTools(
    { request, notify: vi.fn() } as unknown as InteractionConnection,
    performances,
    new AbortController().signal,
    {},
    vi.fn(),
  );
  expect(await tools.vtuber_act.execute!({ script: "看看这里" }, options)).toMatchObject({
    status: "failed",
  });
  expect(performances.size).toBe(0);
  expect(
    await tools.street_view.execute!({ type: "move", direction: "forward" }, options),
  ).toMatchObject({ ok: true });
});
