import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { runStreetView } from "./street-view.js";

afterEach(() => vi.useRealTimers());

it("记录阶段时仍只前进一次，完成后才返回，不重放输入", async () => {
  vi.useFakeTimers();
  const layout = { map: { x: 0, y: 400, width: 1000, height: 300 }, pegman: { x: 500, y: 550 } };
  const send = vi.fn(async () => ({ result: { value: layout } }));
  const release = vi.fn(async () => ({}));
  const stages = [];
  const measure = async (stage, operation) => {
    stages.push([stage, "running"]);
    const result = await operation();
    stages.push([stage, "completed"]);
    return result;
  };
  const task = runStreetView(
    { type: "move", direction: "forward" },
    send,
    release,
    async () => layout,
    measure,
  );
  await vi.runAllTimersAsync();
  await task;
  expect(send.mock.calls[0][0]).toBe("Page.bringToFront");
  expect(send.mock.calls.filter(([method]) => method === "Input.dispatchKeyEvent")).toEqual([
    ["Input.dispatchKeyEvent", expect.objectContaining({ type: "keyDown", key: "ArrowUp" })],
  ]);
  expect(release).toHaveBeenCalledExactlyOnceWith(
    "Input.dispatchKeyEvent",
    expect.objectContaining({ type: "keyUp", key: "ArrowUp" }),
  );
  expect(stages).toEqual([
    ["激活标签页", "running"],
    ["激活标签页", "completed"],
    ["输入操作", "running"],
    ["输入操作", "completed"],
    ["等待街景画面稳定", "running"],
    ["等待街景画面稳定", "completed"],
    ["地图居中", "running"],
    ["地图居中", "completed"],
  ]);
});

it("加载失败向上传递原错误，不居中、不重试移动", async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => ({ result: { value: {} } }));
  const release = vi.fn(async () => ({}));
  const failure = new Error("街景图片加载失败");
  const measure = vi.fn(async (_stage, operation) => await operation());
  const task = runStreetView(
    { type: "move", direction: "forward" },
    send,
    release,
    async () => {
      throw failure;
    },
    measure,
  );
  const rejected = expect(task).rejects.toBe(failure);
  await vi.runAllTimersAsync();
  await rejected;
  expect(send.mock.calls.filter(([method]) => method === "Input.dispatchKeyEvent")).toHaveLength(1);
  expect(measure.mock.calls.map(([stage]) => stage)).not.toContain("地图居中");
});

it.each([
  ["right", 90, 350, 10, 80, 10],
  ["left", 90, 10, 10, 280, 10],
  ["right", 180, 0, 10, 180, 10],
  ["up", 15, 20, 10, 20, 25],
  ["down", 30, 20, 10, 20, -20],
  ["up", 30, 20, 80, 20, 89],
  ["down", 180, 20, 89, 20, -89],
])(
  "%s %s 度按实际视角校正",
  async (direction, angle, heading, pitch, targetHeading, targetPitch) => {
    vi.useFakeTimers();
    let currentHeading = heading;
    let currentPitch = pitch;
    let from;
    let to;
    let drags = 0;
    const layout = () => ({
      panoId: "pano",
      fov: 75,
      panorama: { x: 0, y: 0, width: 1000, height: 500 },
      orientation: { heading: currentHeading, pitch: currentPitch, direction: "北" },
    });
    const send = vi.fn(async (method, input) => {
      if (method === "Input.dispatchMouseEvent" && input.type === "mousePressed") {
        from = input;
      }
      if (method === "Input.dispatchMouseEvent" && input.type === "mouseMoved") {
        to = input;
      }
      return { result: { value: layout() } };
    });
    const release = async () => {
      drags++;
      // 实际角速度与初始估计不同；第一次俯仰还伴随横向偏差，必须按读数校正。
      currentHeading =
        (currentHeading -
          (to.x - from.x) * 0.23 +
          (drags === 1 && direction === "up" ? 4 : 0) +
          360) %
        360;
      currentPitch = Math.max(-89, Math.min(89, currentPitch + (to.y - from.y) * 0.19));
    };
    const task = runStreetView(
      { type: "look", direction, angle },
      send,
      release,
      async () => layout(),
      async (_stage, operation) => await operation(),
    );
    await vi.runAllTimersAsync();
    const actual = await task;
    expect(Math.abs(((actual.heading - targetHeading + 540) % 360) - 180)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(actual.pitch - targetPitch)).toBeLessThanOrEqual(0.5);
    expect(send.mock.calls.some(([method]) => method === "Input.dispatchKeyEvent")).toBe(false);
    const firstPress = send.mock.calls.findIndex(([, input]) => input?.type === "mousePressed");
    expect(send.mock.calls[firstPress - 1]).toEqual([
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseMoved", buttons: 0 }),
    ]);
  },
);

it.each([
  [359.8, 107.13, "北", 17.13],
  [135, 60, "东南", -30],
])("从实际页面地址读取 %s 度朝向", async (heading, tilt, direction, pitch) => {
  const rect = (x, y, width, height) => ({ x, y, width, height, top: y, bottom: y + height });
  const panorama = { getBoundingClientRect: () => rect(0, 0, 1000, 800) };
  const map = { getBoundingClientRect: () => rect(0, 500, 1000, 300) };
  const peg = { getBoundingClientRect: () => rect(490, 640, 20, 20) };
  const report = { href: "https://google.com/local/imagery/report/?image_key=!1e2!2sp" };
  const document = {
    querySelector(selector) {
      return {
        '[role="application"][aria-label="街景"]': panorama,
        '[aria-label="互动地图"]': map,
        ".kDiHkf": peg,
        'a[href*="/local/imagery/report/"]': report,
      }[selector];
    },
    querySelectorAll() {
      return [];
    },
  };
  const send = async (method, params) =>
    method === "Runtime.evaluate"
      ? {
          result: {
            value: runInNewContext(params.expression, {
              document,
              location: { pathname: `/maps/@35,135,3a,75y,${heading}h,${tilt}t/data=x` },
              window: { innerWidth: 1000, innerHeight: 800 },
              URL,
              getComputedStyle: () => ({ backgroundImage: "url(/pegman_v3/icon.png)" }),
            }),
          },
        }
      : {};
  const result = await runStreetView(
    { type: "observe" },
    send,
    send,
    async (send, read) => await read(send),
    async (_stage, operation) => await operation(),
  );
  expect(result.heading).toBeCloseTo(heading);
  expect(result.pitch).toBeCloseTo(pitch);
  expect(result.direction).toBe(direction);
});
