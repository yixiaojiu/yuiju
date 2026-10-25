import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStreetViewLoading } from "./street-view-loading.js";

let bitmap;
let drawImage;
let getImageData;
let loading;
const layout = {
  panoId: "test-pano",
  viewport: { width: 1000, height: 800 },
  panorama: { x: 0, y: 0, width: 1000, height: 500 },
  map: { x: 20, y: 500, width: 960, height: 300 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("chrome", {
    debugger: { onEvent: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
  bitmap = { width: 2000, height: 1600, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  drawImage = vi.fn();
  getImageData = vi.fn((_x, _y, width, height) => ({
    data: new Uint8ClampedArray(width * height * 4),
  }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { drawImage, getImageData };
      }
    },
  );
  loading = createStreetViewLoading(1);
  loading.begin();
});

afterEach(() => {
  loading.end();
  loading.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([1, 1.25, 2])("原视口截图后离屏裁剪地图，像素倍率 %s", async (scale) => {
  bitmap.width = layout.viewport.width * scale;
  bitmap.height = layout.viewport.height * scale;
  const send = vi.fn(async () => ({ data: "AA==" }));
  const task = loading.waitForStable(send, async () => layout, "map");
  await vi.runAllTimersAsync();
  await expect(task).resolves.toEqual(layout);
  expect(send).toHaveBeenCalledTimes(4);
  // 精确限制 CDP 参数：不能重新引入 clip 或设置视口的命令。
  for (const call of send.mock.calls) {
    expect(call).toEqual([
      "Page.captureScreenshot",
      { format: "png", optimizeForSpeed: true, captureBeyondViewport: false },
    ]);
  }
  expect(drawImage).toHaveBeenCalledWith(
    bitmap,
    20 * scale,
    500 * scale,
    960 * scale,
    300 * scale,
    0,
    0,
    320,
    100,
  );
  expect(getImageData).toHaveBeenCalledWith(0, 0, 320, 100);
  expect(bitmap.close).toHaveBeenCalledTimes(4);
});

it("只比较街景区域，保持纵横比", async () => {
  const task = loading.waitForStable(
    async () => ({ data: "AA==" }),
    async () => layout,
    "panorama",
  );
  await vi.runAllTimersAsync();
  await task;
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2000, 1000, 0, 0, 320, 160);
});

it("视口变化后重新累计稳定帧，不沿用旧比例的判断", async () => {
  let reads = 0;
  const resized = { ...layout, viewport: { width: 1200, height: 800 } };
  const readLayout = async () => (++reads <= 5 ? layout : resized);
  const send = vi.fn(async () => ({ data: "AA==" }));
  const task = loading.waitForStable(send, readLayout, "map");
  await vi.runAllTimersAsync();
  await expect(task).resolves.toEqual(resized);
  expect(send).toHaveBeenCalledTimes(7);
});

it("离屏处理失败仍释放图片，不吞掉错误", async () => {
  const failure = new Error("canvas read failed");
  getImageData.mockImplementation(() => {
    throw failure;
  });
  await expect(
    loading.waitForStable(
      async () => ({ data: "AA==" }),
      async () => layout,
      "map",
    ),
  ).rejects.toBe(failure);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});
