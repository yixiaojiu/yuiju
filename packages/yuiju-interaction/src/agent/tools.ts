import { tool } from "ai";
import { z } from "zod";
import {
  browserActionSchema,
  type OptionalToolName,
  type Screen,
  screenSchema,
  streetViewSchema,
  streetViewScreenSchema,
} from "../protocol.ts";
import type { InteractionConnection } from "./connection.ts";

/** 当前轮次决定等待或结束；不是跨轮次运行状态。 */
export type RoundDecision = { waitSeconds?: number; summary?: string; performanceQueued?: boolean };

/** 只在场景内部投递；截图由下一轮 loop 转成模型图片输入。 */
export type ObservationEvent = {
  type: "observation";
  toolCallId: string;
  toolName: OptionalToolName;
  screen: Screen;
};

export function createInteractionTools(
  connection: InteractionConnection,
  performances: Map<string, string>,
  signal: AbortSignal,
  decision: RoundDecision,
  observe: (event: ObservationEvent) => void,
) {
  let moving = false;
  const browser =
    (method: "observe" | "action" | "street_view", toolName: OptionalToolName) =>
    async (input: unknown, { toolCallId }: { toolCallId: string }) => {
      try {
        const screen = (method === "street_view" ? streetViewScreenSchema : screenSchema).parse(
          await connection.request("browser", method, input, signal),
        );
        connection.notify({ type: "screen", screen });
        observe({ type: "observation", toolCallId, toolName, screen });
        const { image: _image, ...metadata } = screen;
        return { ok: true as const, screen: metadata };
      } catch (error) {
        signal.throwIfAborted();
        return { ok: false as const, error: String(error) };
      }
    };
  return {
    observe_screen: tool({
      description: "查看当前选定标签页的真实画面。返回页面信息，截图作为后续观察输入。",
      inputSchema: z.object({}),
      execute: browser("observe", "observe_screen"),
    }),
    browser_action: tool({
      description:
        "在选定标签页执行一次操作，返回执行结果与页面信息，操作后的截图作为后续观察输入。坐标使用最近截图上的像素位置，点击是否命中由你根据新画面判断。本次启用 street_view 时，Google Maps 街景游览优先使用该工具。",
      inputSchema: browserActionSchema,
      execute: browser("action", "browser_action"),
    }),
    street_view: tool({
      description:
        "在已打开的 Google Maps 街景中探索，要求下方地图展开。move 沿当前朝向前进或后退一个可通行节点；look 按上下左右方向和 angle 角度调整视角；zoom 只调整下方地图倍率。台本排队、合成或播放期间，observe、look、zoom 可正常执行，move 返回 busy；已有移动正在执行时，新的 move 也返回 busy。busy 表示未执行、未排队，等待完成反馈后再决策，不要反复尝试或改用 browser_action 绕过限制。每次成功返回实际 orientation：heading 为北起顺时针角度，direction 为八方位朝向，pitch 为俯仰角（正数抬头）。操作后等待加载、自动将地图上的黄色小人居中，完整截图作为后续观察输入。是否移动成功、画面是否清晰，以观察画面为准；模糊时可等待后再 observe，不要重复移动。",
      inputSchema: streetViewSchema,
      execute: async (input, options) => {
        signal.throwIfAborted();
        if (input.type !== "move") {
          return await browser("street_view", "street_view")(input, options);
        }
        if (performances.size) {
          return {
            status: "busy",
            message: "台本尚未播放完，未执行移动。等待播放完成后再决定是否移动。",
          };
        }
        if (moving) {
          return { status: "busy", message: "正在移动，未执行新的移动。等待观察结果后再决策。" };
        }
        moving = true;
        try {
          return await browser("street_view", "street_view")(input, options);
        } finally {
          moving = false;
        }
      },
    }),
    vtuber_act: tool({
      description:
        "提交一小段台词与表演，只确认入队。成功入队后你可以继续决策，在合成和播放期间观察、转向或缩放地图；当前台本播放完后才能提交下一段台词或执行街景移动。街景移动期间返回 busy，不会入队，等待移动后的观察结果再决定台词。",
      inputSchema: z.object({ script: z.string().trim().min(1) }),
      execute: async ({ script }, { toolCallId }) => {
        signal.throwIfAborted();
        if (moving) {
          return {
            status: "busy",
            message: "正在移动，台本未入队。等待移动后的观察结果再决定台词。",
          };
        }
        if (performances.size) {
          return {
            status: "busy",
            message: "上一段台本尚未播放完，可以继续观察、转向、缩放地图或等待播放完成。",
          };
        }
        performances.set(toolCallId, script);
        try {
          await connection.request("page", "perform", { script, toolCallId }, signal);
          decision.performanceQueued = true;
          return { status: "queued", message: "已入队，尚未播放完成。" };
        } catch (error) {
          performances.delete(toolCallId);
          signal.throwIfAborted();
          return { status: "failed", error: String(error) };
        }
      },
    }),
    wait: tool({
      description:
        "暂时没有其他行动时，安排延迟观察或休息；时间到或收到新事件后继续互动。工具截图和表演结果会自动成为后续输入，不必为等这些结果反复调用 wait。",
      inputSchema: z.object({ seconds: z.number().min(1).max(60) }),
      execute: async ({ seconds }) => {
        signal.throwIfAborted();
        decision.waitSeconds = seconds;
        return { status: "waiting", seconds };
      },
    }),
    finish: tool({
      description: "结束本次互动，向主 agent 总结实际经历。仍有台词播放时，等待播完再结束。",
      inputSchema: z.object({ summary: z.string().min(1) }),
      execute: async ({ summary }) => {
        signal.throwIfAborted();
        if (performances.size) {
          return { status: "busy", message: "收尾台词尚未播放完。" };
        }
        decision.summary = summary;
        return { status: "finished" };
      },
    }),
  };
}
