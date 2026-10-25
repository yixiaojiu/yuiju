/** send 检查请求取消；release 只负责释放已按下的输入，取消后仍须执行。 */
export async function clickMouse(send, release, position) {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...position,
  });
  await release("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...position,
  });
}

/** 平滑拖动并在终点停稳，避免街景、地图在抬键后继续惯性移动。 */
export async function dragMouse(send, release, from, to) {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...from,
  });
  let position = from;
  try {
    for (let step = 1; step <= 10; step++) {
      position = {
        x: from.x + ((to.x - from.x) * step) / 10,
        y: from.y + ((to.y - from.y) * step) / 10,
      };
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        ...position,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    await release("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      ...position,
    });
  }
}

/** 持续按下指定毫秒；用于需要按键持续时间的街景转向，不发送自动重复的按键。 */
export async function pressKey(send, release, key, durationMs) {
  const codes = {
    Enter: 13,
    Escape: 27,
    Tab: 9,
    Backspace: 8,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };
  const input = { key, code: key, windowsVirtualKeyCode: codes[key] };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...input });
  try {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } finally {
    await release("Input.dispatchKeyEvent", { type: "keyUp", ...input });
  }
}
