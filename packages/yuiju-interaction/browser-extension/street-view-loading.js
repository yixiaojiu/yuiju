/** 只跟踪实测的街景瓦片端点；不把邻近全景预加载或埋点当作当前画面的加载。 */
export function createStreetViewLoading(tabId) {
  const pending = new Map();
  const failures = new Map();
  let active = false;
  let panoId;
  let revision = 0;
  let deadline = 0;

  function onEvent(source, method, params) {
    if (source.tabId !== tabId) {
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const url = new URL(params.request.url);
      if (
        url.hostname !== "streetviewpixels-pa.clients6.google.com" ||
        url.pathname !== "/v1/tile"
      ) {
        return;
      }
      const requestPano = url.searchParams.get("panoid");
      pending.set(params.requestId, requestPano);
      if (requestPano === panoId) {
        revision++;
      }
      return;
    }
    if (!pending.has(params.requestId)) {
      return;
    }
    const requestPano = pending.get(params.requestId);
    if (method === "Network.responseReceived" && params.response.status >= 400 && active) {
      failures.set(requestPano, `街景图片请求失败：HTTP ${params.response.status}`);
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      if (requestPano === panoId) {
        revision++;
      }
      // 视角变化会取消不再需要的瓦片；取消不等同于下载失败。
      if (method === "Network.loadingFailed" && !params.canceled && active) {
        failures.set(requestPano, `街景图片加载失败：${params.errorText}`);
      }
    }
  }
  chrome.debugger.onEvent.addListener(onEvent);

  return {
    begin() {
      active = true;
      failures.clear();
      panoId = undefined;
      revision = 0;
      // 这是整次操作的失败上限，不是每步固定等待；早于后端 30 秒请求超时。
      deadline = Date.now() + 15_000;
    },
    end() {
      active = false;
      failures.clear();
      panoId = undefined;
    },
    dispose() {
      chrome.debugger.onEvent.removeListener(onEvent);
      pending.clear();
      failures.clear();
    },
    async waitForStable(send, readLayout, area) {
      const startedAt = Date.now();
      let previous;
      let previousRegion;
      let previousRevision;
      let stableFrames = 0;
      let samples = 0;
      while (Date.now() < deadline) {
        const layout = await readLayout(send);
        if (panoId !== layout.panoId) {
          panoId = layout.panoId;
          previous = undefined;
          stableFrames = 0;
        }
        if (failures.has(panoId)) {
          throw new Error(`${failures.get(panoId)}。操作可能已执行，请观察，不要重复移动`);
        }
        const region = layout[area];
        const regionKey = JSON.stringify([region, layout.viewport]);
        const version = revision;
        // CDP 的 clip 会临时调整渲染视口，导致街景闪白；截取原视口后再离屏裁剪。
        const frame = await send("Page.captureScreenshot", {
          format: "png",
          optimizeForSpeed: true,
          captureBeyondViewport: false,
        });
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(atob(frame.data), (character) => character.charCodeAt(0))], {
            type: "image/png",
          }),
        );
        let pixels;
        try {
          const canvas = new OffscreenCanvas(320, Math.round((320 * region.height) / region.width));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          // DOM 使用 CSS 像素，截图使用实际像素；按本帧尺寸换算，包含 Retina 与页面缩放。
          const scaleX = bitmap.width / layout.viewport.width;
          const scaleY = bitmap.height / layout.viewport.height;
          context.drawImage(
            bitmap,
            region.x * scaleX,
            region.y * scaleY,
            region.width * scaleX,
            region.height * scaleY,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        } finally {
          bitmap.close();
        }
        const latest = await readLayout(send);
        samples++;
        const loading = Array.from(pending.values()).includes(panoId);
        if (failures.has(panoId)) {
          throw new Error(`${failures.get(panoId)}。操作可能已执行，请观察，不要重复移动`);
        }
        let changedPixels = 0;
        if (previous && previousRegion === regionKey && previous.length === pixels.length) {
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              Math.max(
                Math.abs(pixels[index] - previous[index]),
                Math.abs(pixels[index + 1] - previous[index + 1]),
                Math.abs(pixels[index + 2] - previous[index + 2]),
              ) > 8
            ) {
              changedPixels++;
            }
          }
          const unchanged = changedPixels / (pixels.length / 4) < 0.01;
          stableFrames =
            unchanged &&
            !loading &&
            version === revision &&
            version === previousRevision &&
            latest.panoId === panoId &&
            JSON.stringify([latest[area], latest.viewport]) === regionKey
              ? stableFrames + 1
              : 0;
        } else {
          stableFrames = 0;
        }
        previous = pixels;
        previousRegion = regionKey;
        previousRevision = version;
        // 连续三次采样稳定，且当前全景没有未完成的瓦片；不是高清完成的官方信号。
        if (stableFrames >= 3 && Date.now() < deadline) {
          console.info("street_view 画面稳定", {
            area,
            durationMs: Date.now() - startedAt,
            samples,
          });
          return latest;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("街景加载或画面稳定检查超时。操作可能已执行，请观察，不要重复移动");
    },
  };
}
