import { clickMouse, dragMouse, pressKey } from "./browser-input.js";
import { runStreetView } from "./street-view.js";
import { createStreetViewLoading } from "./street-view-loading.js";

let socket;
let heartbeat;
let reconnectTimer;
let disconnecting = false;
// tab 的调试授权独立于每一次后端连接；attachment 供主动断开等待 attach 完成。
let target;
let screenshot;
let pending = [];
let running = false;
const cancelled = new Set();

async function setStatus(status) {
  await chrome.storage.session.set(status);
}
function send(current, message) {
  if (current === socket && current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify(message));
  }
}
async function disconnect() {
  if (disconnecting) {
    throw new Error("正在断开，请等待完成");
  }
  disconnecting = true;
  const previousTarget = target;
  target = undefined;
  clearTimeout(reconnectTimer);
  clearInterval(heartbeat);
  const previous = socket;
  socket = undefined;
  previous?.close();
  pending = [];
  cancelled.clear();
  screenshot = undefined;
  try {
    if (previousTarget !== undefined) {
      await previousTarget.attachment;
      previousTarget.streetViewLoading?.dispose();
      await chrome.debugger.detach({ tabId: previousTarget.tabId });
    }
  } finally {
    disconnecting = false;
    await setStatus({ targetTabId: null, tabStatus: "未连接", backendStatus: "已停止连接" });
  }
}
async function connect(connection, selectedTabId) {
  if (target !== undefined || running || disconnecting) {
    throw new Error("请先断开当前目标，等待在途操作结束");
  }
  const url = new URL(connection.url);
  if (url.protocol !== "ws:" || typeof connection.token !== "string") {
    throw new Error("连接信息不正确");
  }
  const selected = {
    tabId: selectedTabId,
    connection,
    attachment: chrome.debugger.attach({ tabId: selectedTabId }, "1.3"),
  };
  target = selected;
  setStatus({ targetTabId: selectedTabId, tabStatus: "正在连接标签页", backendStatus: "尚未连接" });
  try {
    await selected.attachment;
  } catch (error) {
    if (target === selected) {
      target = undefined;
      await setStatus({
        targetTabId: null,
        tabStatus: `连接失败：${String(error)}`,
        backendStatus: "尚未连接",
      });
    }
    throw error;
  }
  // attach 期间可能已收到主动断开；由 disconnect 等待后解除授权。
  if (target !== selected) {
    return;
  }
  try {
    selected.streetViewLoading = createStreetViewLoading(selected.tabId);
    await chrome.debugger.sendCommand({ tabId: selected.tabId }, "Network.enable");
    if (target !== selected) {
      return;
    }
    await chrome.storage.local.set({ connection: JSON.stringify(connection) });
  } catch (error) {
    if (target === selected) {
      await disconnect();
    }
    throw error;
  }
  if (target !== selected) {
    return;
  }
  await setStatus({ tabStatus: `已连接 · tab ${selectedTabId}` });
  if (target === selected) {
    connectBackend(selected);
  }
}

/** 每次关闭后仅安排一次重连；用户解除 tab 绑定即停止。 */
function connectBackend(selected) {
  const current = new WebSocket(selected.connection.url);
  socket = current;
  setStatus({ backendStatus: "正在连接后端" });
  current.onopen = () => {
    if (socket !== current) {
      return;
    }
    send(current, { type: "hello", role: "browser", token: selected.connection.token });
    heartbeat = setInterval(() => send(current, { type: "ping" }), 20_000);
    setStatus({ backendStatus: "等待后端认证" });
  };
  current.onmessage = (event) => {
    if (socket !== current) {
      return;
    }
    const message = JSON.parse(event.data);
    if (message.type === "request") {
      pending.push({ ...message, socket: current, target: selected });
      drain();
    }
    if (message.type === "cancel") {
      cancelled.add(message.id);
    }
    if (message.type === "status") {
      setStatus({ backendStatus: `已连接 · ${message.phase}` });
    }
    if (message.type === "error") {
      setStatus({ backendStatus: message.message });
    }
  };
  current.onclose = (event) => {
    if (socket !== current) {
      return;
    }
    socket = undefined;
    clearInterval(heartbeat);
    pending = [];
    cancelled.clear();
    screenshot = undefined;
    reconnectTimer = setTimeout(() => {
      if (target === selected) {
        connectBackend(selected);
      }
    }, 2000);
    setStatus({
      backendStatus: `后端已断开，2 秒后重连${event.reason ? ` · ${event.reason}` : ""}`,
    });
  };
  // WebSocket 的连接失败随后会触发 close，重连只在 close 中安排。
  current.onerror = () => {
    if (socket === current) {
      setStatus({ backendStatus: "后端连接失败，等待重连" });
    }
  };
}

function assertRequestActive(request) {
  if (request.socket !== socket || request.target !== target || cancelled.has(request.id)) {
    throw new Error("操作已取消或所属连接已断开");
  }
}
/** 调用前检查取消；已发给浏览器的操作不能回滚，禁止自动重放。 */
async function command(request, method, params = {}) {
  assertRequestActive(request);
  // 已发送的按键/鼠标按下仍要把回执交给 release，取消只阻止下一次新操作。
  return await chrome.debugger.sendCommand({ tabId: request.target.tabId }, method, params);
}
async function observe(request) {
  const metrics = await command(request, "Page.getLayoutMetrics");
  const viewport = metrics.cssVisualViewport;
  const result = await command(request, "Page.captureScreenshot", {
    format: "jpeg",
    quality: 70,
    captureBeyondViewport: false,
  });
  const image = await createImageBitmap(
    await (await fetch(`data:image/jpeg;base64,${result.data}`)).blob(),
  );
  try {
    const tab = await chrome.tabs.get(request.target.tabId);
    assertRequestActive(request);
    screenshot = {
      width: image.width,
      height: image.height,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
    };
    return {
      width: screenshot.width,
      height: screenshot.height,
      image: result.data,
      title: tab.title,
      url: tab.url,
    };
  } finally {
    image.close();
  }
}
async function action(request, input, sendCommand, release, measure) {
  const point = (x, y) => {
    if (!screenshot) {
      throw new Error("请先观察画面，再使用截图坐标操作");
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= screenshot.width ||
      y >= screenshot.height
    ) {
      throw new Error("坐标超出截图范围");
    }
    return {
      x: (x * screenshot.viewportWidth) / screenshot.width,
      y: (y * screenshot.viewportHeight) / screenshot.height,
    };
  };
  if (input.type === "click") {
    await clickMouse(sendCommand, release, point(input.x, input.y));
  } else if (input.type === "drag") {
    await dragMouse(sendCommand, release, point(input.x, input.y), point(input.toX, input.toY));
  } else if (input.type === "scroll") {
    await sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      ...point(input.x, input.y),
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    });
  } else if (input.type === "type") {
    await sendCommand("Input.insertText", { text: input.text });
  } else if (input.type === "key") {
    await pressKey(sendCommand, release, input.key, 100);
  } else {
    throw new Error("不支持的浏览器操作");
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return await measure("最终截图", () => observe(request));
}
async function drain() {
  if (running) {
    return;
  }
  running = true;
  try {
    while (pending.length) {
      const request = pending.shift();
      try {
        // 释放输入绑定本次操作的标签页，不能随连接变化释放到另一个目标。
        const inputTarget = { tabId: request.target.tabId };
        const sendCommand = (method, params) => command(request, method, params);
        const release = (method, params) =>
          chrome.debugger.sendCommand(inputTarget, method, params);
        // 同一个请求 ID 贯穿正式调用和手动测试；只传阶段信息，不传截图数据。
        async function measure(stage, operation) {
          const startedAt = Date.now();
          send(request.socket, {
            type: "browser_progress",
            id: request.id,
            stage,
            state: "running",
            durationMs: 0,
          });
          try {
            const value = await operation();
            send(request.socket, {
              type: "browser_progress",
              id: request.id,
              stage,
              state: "completed",
              durationMs: Date.now() - startedAt,
            });
            return value;
          } catch (error) {
            send(request.socket, {
              type: "browser_progress",
              id: request.id,
              stage,
              state: "failed",
              durationMs: Date.now() - startedAt,
              detail: String(error),
            });
            throw error;
          }
        }
        let value;
        if (request.method === "observe") {
          value = await measure("最终截图", () => observe(request));
        } else if (request.method === "action") {
          value = await measure("浏览器操作", () =>
            action(request, request.input, sendCommand, release, measure),
          );
        } else if (request.method === "street_view") {
          const loading = request.target.streetViewLoading;
          loading.begin();
          try {
            const orientation = await runStreetView(
              request.input,
              sendCommand,
              release,
              loading.waitForStable,
              measure,
            );
            value = { ...(await measure("最终截图", () => observe(request))), orientation };
          } finally {
            loading.end();
          }
        } else {
          throw new Error("未知浏览器命令");
        }
        send(request.socket, { type: "result", id: request.id, result: { ok: true, value } });
      } catch (error) {
        send(request.socket, {
          type: "result",
          id: request.id,
          result: { ok: false, error: String(error) },
        });
      } finally {
        cancelled.delete(request.id);
      }
    }
  } finally {
    running = false;
  }
}
chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (source.tabId === target?.tabId) {
    target.streetViewLoading?.dispose();
    target = undefined;
    await disconnect();
    await setStatus({ tabStatus: `标签页调试连接已解除 · ${reason}，请重新选择标签页` });
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  async function handle() {
    try {
      if (message.type === "connect") {
        await connect(message.connection, message.tabId);
      } else if (message.type === "disconnect") {
        await disconnect();
      } else {
        throw new Error("未知命令");
      }
      respond({ ok: true });
    } catch (error) {
      respond({ error: String(error) });
    }
  }
  handle();
  return true;
});
