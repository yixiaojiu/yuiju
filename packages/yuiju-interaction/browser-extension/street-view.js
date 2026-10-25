import { clickMouse, dragMouse, pressKey } from "./browser-input.js";

/** 在 Google Maps 页面内读取可见布局，不访问页面的私有地图实例。 */
function readStreetViewLayout() {
  const panorama = document.querySelector('[role="application"][aria-label="街景"]');
  const map = document.querySelector('[aria-label="互动地图"]');
  const pegman = document.querySelector(".kDiHkf");
  const report = document.querySelector('a[href*="/local/imagery/report/"]');
  if (!panorama || !map || !pegman) {
    throw new Error("无法识别街景、下方地图或黄色小人，请打开 Google Maps 街景并展开地图");
  }
  const imageKey = report && new URL(report.href).searchParams.get("image_key");
  if (!imageKey || !imageKey.startsWith("!1e2!2s")) {
    throw new Error("无法从街景报告链接读取当前全景标识");
  }
  const angles = location.pathname.match(/,([\d.]+)y,(-?[\d.]+)h,(-?[\d.]+)t(?:\/|$)/);
  if (!angles) {
    throw new Error("无法从当前 Google Maps 地址读取视角");
  }
  const heading = ((Number(angles[2]) % 360) + 360) % 360;
  const pitch = Number(angles[3]) - 90;
  const view = panorama.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const peg = pegman.getBoundingClientRect();
  if (mapRect.width <= 200 || mapRect.height <= 120 || peg.width === 0 || peg.height === 0) {
    throw new Error("下方地图未展开或尺寸不足，请增大地图区域");
  }
  if (!getComputedStyle(pegman).backgroundImage.includes("/pegman_v3/")) {
    throw new Error("Google Maps 黄色小人元素已变化，无法自动居中");
  }
  // 街景容器覆盖整窗；实际可操作范围截至下方地图顶部。
  const panoramaBottom = Math.min(view.bottom, mapRect.top);
  if (panoramaBottom <= view.top) {
    throw new Error("街景画面不可见");
  }
  const zoom = {};
  for (const button of document.querySelectorAll(
    'button[aria-label="放大"],button[aria-label="缩小"]',
  )) {
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      continue;
    }
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    if (y < mapRect.top || y >= mapRect.bottom) {
      continue;
    }
    const direction = button.getAttribute("aria-label") === "放大" ? "in" : "out";
    zoom[direction] = { x, y };
  }
  return {
    panoId: imageKey.slice("!1e2!2s".length),
    fov: Number(angles[1]),
    orientation: {
      heading,
      direction: ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][
        Math.round(heading / 45) % 8
      ],
      pitch,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panorama: { x: view.x, y: view.y, width: view.width, height: panoramaBottom - view.y },
    map: { x: mapRect.x, y: mapRect.y, width: mapRect.width, height: mapRect.height },
    pegman: { x: peg.x + peg.width / 2, y: peg.y + peg.height / 2 },
    zoom,
  };
}

async function inspectStreetView(send) {
  const result = await send("Runtime.evaluate", {
    expression: `(${readStreetViewLayout.toString()})()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception.description);
  }
  return result.result.value;
}

/** 移动或缩放地图后将黄色小人居中；截图由调用方统一生成。 */
export async function runStreetView(input, send, release, waitForStable, measure) {
  // 街景依赖持续渲染和输入反馈；执行前激活目标页，避免隐藏标签页暂停画面更新。
  await measure("激活标签页", () => send("Page.bringToFront"));
  if (input.type === "observe") {
    const current = await measure("等待街景画面稳定", () =>
      waitForStable(send, inspectStreetView, "panorama"),
    );
    return current.orientation;
  }
  await measure("输入操作", async () => {
    const layout = await inspectStreetView(send);
    if (input.type === "move") {
      // Google Maps 的按键监听位于可聚焦画布，聚焦外层 application 不会移动街景。
      const focus = await send("Runtime.evaluate", {
        expression:
          'document.querySelector(\'[role="application"][aria-label="街景"] canvas[tabindex="-1"]\').focus()',
      });
      if (focus.exceptionDetails) {
        throw new Error(focus.exceptionDetails.exception.description);
      }
      await pressKey(send, release, input.direction === "forward" ? "ArrowUp" : "ArrowDown", 100);
    } else if (input.type === "look") {
      const horizontal = input.direction === "left" || input.direction === "right";
      const sign = input.direction === "right" || input.direction === "up" ? 1 : -1;
      const targetHeading =
        (layout.orientation.heading + (horizontal ? sign * input.angle : 0) + 360) % 360;
      // 网页版实测俯仰范围为 -89°～89°，到边界停止，不继续向不可达角度校正。
      const targetPitch = Math.max(
        -89,
        Math.min(89, layout.orientation.pitch + (horizontal ? 0 : sign * input.angle)),
      );
      let current = layout;
      // 初始位移按视野估计，后续用实际角度变化校准；每步最多拖动可见区域的一部分。
      let degreesPerPixelX = layout.fov / layout.panorama.height;
      let degreesPerPixelY = degreesPerPixelX;
      for (let step = 0; step < 10; step++) {
        let headingError = ((targetHeading - current.orientation.heading + 540) % 360) - 180;
        if (headingError === -180 && input.direction === "right") {
          headingError = 180;
        }
        const pitchError = targetPitch - current.orientation.pitch;
        if (Math.abs(headingError) <= 0.5 && Math.abs(pitchError) <= 0.5) {
          return;
        }
        const view = current.panorama;
        const dx = -Math.max(
          -view.width * 0.35,
          Math.min(view.width * 0.35, headingError / degreesPerPixelX),
        );
        const dy = Math.max(
          -view.height * 0.4,
          Math.min(view.height * 0.4, pitchError / degreesPerPixelY),
        );
        const from = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
        // 先移动到拖动起点，确保页面的指针状态与按下位置一致。
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", buttons: 0, ...from });
        await dragMouse(send, release, from, { x: from.x + dx, y: from.y + dy });
        let latest = current;
        let changed = false;
        let stable = 0;
        // 地址更新异步发生；确认视角已变化且连续三次读数相同，再计算下一次修正。
        for (let sample = 0; sample < 20; sample++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const next = await inspectStreetView(send);
          if (next.panoId !== layout.panoId) {
            throw new Error("旋转期间街景位置发生变化，请重新观察");
          }
          if (
            next.orientation.heading !== latest.orientation.heading ||
            next.orientation.pitch !== latest.orientation.pitch
          ) {
            changed = true;
            stable = 0;
          } else if (changed) {
            stable++;
          }
          latest = next;
          if (stable >= 3) {
            break;
          }
        }
        if (!changed || stable < 3) {
          throw new Error(
            `旋转视角未更新或未稳定，当前朝向 ${latest.orientation.heading}°，俯仰 ${latest.orientation.pitch}°`,
          );
        }
        const turned =
          ((latest.orientation.heading - current.orientation.heading + 540) % 360) - 180;
        const tilted = latest.orientation.pitch - current.orientation.pitch;
        if (Math.abs(dx) > 1 && Math.abs(turned) > 0.1) {
          degreesPerPixelX = Math.abs(turned / dx);
        }
        if (Math.abs(dy) > 1 && Math.abs(tilted) > 0.1) {
          degreesPerPixelY = Math.abs(tilted / dy);
        }
        current = latest;
      }
      const headingError = ((targetHeading - current.orientation.heading + 540) % 360) - 180;
      if (Math.abs(headingError) > 0.5 || Math.abs(targetPitch - current.orientation.pitch) > 0.5) {
        throw new Error(
          `旋转未达到目标角度，当前朝向 ${current.orientation.heading}°，俯仰 ${current.orientation.pitch}°`,
        );
      }
    } else if (input.type === "zoom") {
      const position = layout.zoom[input.direction];
      if (!position) {
        throw new Error("未找到对应的缩放按钮");
      }
      await clickMouse(send, release, position);
    }
  });

  const area = input.type === "zoom" ? "map" : "panorama";
  const current = await measure(area === "map" ? "等待地图画面稳定" : "等待街景画面稳定", () =>
    waitForStable(send, inspectStreetView, area),
  );
  if (input.type === "look") {
    return current.orientation;
  }
  return await measure("地图居中", async () => {
    const map = current.map;
    const dx = map.x + map.width / 2 - current.pegman.x;
    const dy = map.y + map.height / 2 - current.pegman.y;
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
      return current.orientation;
    }

    // 偏移超出地图可拖动范围时分段平移，每段都留在地图内；不是重试操作。
    const segments = Math.ceil(
      Math.max(Math.abs(dx) / (map.width - 200), Math.abs(dy) / (map.height - 120)),
    );
    for (let segment = 0; segment < segments; segment++) {
      const from = {
        x: dx >= 0 ? map.x + 100 : map.x + map.width - 100,
        y: dy >= 0 ? map.y + 40 : map.y + map.height - 80,
      };
      await dragMouse(send, release, from, {
        x: from.x + dx / segments,
        y: from.y + dy / segments,
      });
      await measure("等待地图画面稳定", () => waitForStable(send, inspectStreetView, "map"));
    }
    const centered = await inspectStreetView(send);
    if (
      Math.abs(centered.pegman.x - (centered.map.x + centered.map.width / 2)) > 4 ||
      Math.abs(centered.pegman.y - (centered.map.y + centered.map.height / 2)) > 4
    ) {
      throw new Error("街景操作已执行，但地图未能居中。请先观察当前画面，不要重复移动");
    }
    return centered.orientation;
  });
}
