import { z } from "zod";

/** 程序提供的动作；模型表情由 model3.json 声明，不在协议里枚举。 */
export const builtInActions: readonly string[] = ["点头", "摇头", "恢复"];

export const optionalToolNames = ["observe_screen", "browser_action", "street_view"] as const;
export type OptionalToolName = (typeof optionalToolNames)[number];

/** 场景就绪后交给控制页编辑；人设只读，其余输入仅对本次运行生效。 */
export type ScenePreparation = {
  persona: string;
  scenePrompt: string;
  sceneContent: string;
  scenePresets: { key: string; name: string; content: string }[];
  characterPrompt: string;
  context: string;
  /** 用户启用的可选工具；表演、等待和结束始终启用。 */
  enabledTools: OptionalToolName[];
  simulateSpeech: boolean;
};

const sceneEntrySchema = z.object({
  type: z.literal("enter"),
  scenePrompt: z.string().trim().min(1),
  sceneContent: z.string(),
  context: z.string(),
  enabledTools: z.array(z.enum(optionalToolNames)),
  simulateSpeech: z.boolean(),
});
export type SceneEntry = z.infer<typeof sceneEntrySchema>;

/** 控制页渲染前的完整模型参数，Live2D 展示页只应用这些值，不重放台本或重新生成声音。 */
export const live2dFrameSchema = z.object({
  parameters: z.array(z.number()),
  parts: z.array(z.number()),
});
export type Live2DFrame = z.infer<typeof live2dFrameSchema>;

export const screenSchema = z.object({
  image: z.string(),
  width: z.number(),
  height: z.number(),
  title: z.string(),
  url: z.string(),
});
export type Screen = z.infer<typeof screenSchema>;
export const streetViewOrientationSchema = z.object({
  heading: z.number().min(0).lt(360).describe("水平朝向：北为 0°，顺时针增加"),
  direction: z.enum(["北", "东北", "东", "东南", "南", "西南", "西", "西北"]),
  pitch: z.number().min(-90).max(90).describe("俯仰角：0° 为水平，正数抬头，负数低头"),
});
export const streetViewScreenSchema = screenSchema.extend({
  orientation: streetViewOrientationSchema,
});
export type StreetViewScreen = z.infer<typeof streetViewScreenSchema>;
const point = { x: z.number().nonnegative(), y: z.number().nonnegative() };
export const browserActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), ...point }),
  z.object({
    type: z.literal("drag"),
    ...point,
    toX: z.number().nonnegative(),
    toY: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("scroll"),
    ...point,
    deltaX: z.number(),
    deltaY: z.number(),
  }),
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({
    type: z.literal("key"),
    key: z.enum([
      "Enter",
      "Escape",
      "Tab",
      "Backspace",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ]),
  }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;
/** 街景工具使用方向与角度，不要求模型填写截图坐标。 */
export const streetViewSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("observe") }),
  z.strictObject({
    type: z.literal("move"),
    direction: z
      .enum(["forward", "backward"])
      .describe("沿你当前朝向前进或后退一个街景节点；后退不是撤销上一步移动"),
  }),
  z.strictObject({
    type: z.literal("look"),
    direction: z.enum(["left", "right", "up", "down"]),
    angle: z
      .number()
      .min(1)
      .max(180)
      .describe(
        "你希望相对当前视角旋转的角度（度）；上下旋转到 -89°～89° 的俯仰边界时停止，以返回的实际视角为准",
      ),
  }),
  z.strictObject({
    type: z.literal("zoom"),
    direction: z.enum(["in", "out"]),
  }),
]);
const incompleteSpeechSchema = z.object({
  text: z.string().describe("未完整播放的这一句全文，不代表已经说出的内容"),
  playedMs: z.number().nonnegative(),
  durationMs: z.number().positive(),
});
export const performanceEventSchema = z.discriminatedUnion("status", [
  z.object({
    type: z.literal("performance"),
    toolCallId: z.string(),
    status: z.literal("speech"),
    text: z.string().describe("已完整播放的这一句台词"),
  }),
  z.object({
    type: z.literal("performance"),
    toolCallId: z.string(),
    status: z.literal("completed"),
  }),
  z.object({
    type: z.literal("performance"),
    toolCallId: z.string(),
    status: z.literal("interrupted"),
    incompleteSpeech: incompleteSpeechSchema.nullable(),
  }),
  z.object({
    type: z.literal("performance"),
    toolCallId: z.string(),
    status: z.literal("failed"),
    error: z.string(),
    incompleteSpeech: incompleteSpeechSchema.nullable(),
  }),
]);
export type PerformanceEvent = z.infer<typeof performanceEventSchema>;

export const inputEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().trim().min(1) }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("exit"), reason: z.string() }),
  z.object({ type: z.literal("continue") }),
  performanceEventSchema,
]);
export type InputEvent = z.infer<typeof inputEventSchema>;
export const browserTestCommandSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("observe"), input: z.object({}) }),
  z.object({ method: z.literal("action"), input: browserActionSchema }),
  z.object({ method: z.literal("street_view"), input: streetViewSchema }),
]);
export type BrowserTestCommand = z.infer<typeof browserTestCommandSchema>;

const browserProgressSchema = z.object({
  type: z.literal("browser_progress"),
  id: z.string(),
  stage: z.string(),
  state: z.enum(["running", "completed", "failed"]),
  durationMs: z.number().nonnegative(),
  detail: z.string().optional(),
});
export type BrowserProgress = z.infer<typeof browserProgressSchema>;
export type BrowserTestResult = {
  type: "browser_test_result";
  id: string;
  durationMs: number;
  result: { ok: true; screen: Screen | StreetViewScreen } | { ok: false; error: string };
};

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("browser_test"),
    id: z.string().uuid(),
    command: browserTestCommandSchema,
  }),
  browserProgressSchema,
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("hello"),
    role: z.enum(["page", "browser", "observer"]),
    token: z.string(),
  }),
  sceneEntrySchema,
  z.object({ type: z.literal("live2d_frame"), frame: live2dFrameSchema }),
  z.object({ type: z.literal("subtitle"), text: z.string() }),
  z.object({ type: z.literal("event"), event: inputEventSchema }),
  z.object({
    type: z.literal("result"),
    id: z.string(),
    result: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: z.unknown() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** 仅供调试展示的执行事实，不参与 agent 决策或上下文。 */
export type AgentActivity = {
  type: "agent_activity";
  model: string;
  state:
    | "preparing"
    | "model"
    | "tools"
    | "waiting"
    | "performance"
    | "paused"
    | "compressing"
    | "ended"
    | "failed";
  at: number;
  round: number;
  until?: number;
  detail?: string;
};

export type ContextUsage = {
  type: "context_usage";
  tokens: number;
  windowTokens: number;
};

export type ModelUsage = {
  type: "model_usage";
  at: number;
  model: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

export type CompressionStatus = {
  type: "compression_status";
  state: "running" | "ready" | "applied" | "failed" | "cancelled";
  at: number;
  detail?: string;
};

export type ToolExecution = {
  type: "tool_execution";
  id: string;
  name: string;
  state: "running" | "completed" | "failed" | "cancelled";
  at: number;
  detail: string;
  durationMs?: number;
};

export type ServerMessage =
  | BrowserProgress
  | BrowserTestResult
  | AgentActivity
  | ContextUsage
  | ModelUsage
  | CompressionStatus
  | ToolExecution
  | { type: "preparation"; preparation: ScenePreparation }
  | { type: "live2d_frame"; frame: Live2DFrame }
  | { type: "subtitle"; text: string }
  | { type: "status"; phase: string; browserConnected: boolean }
  | {
      type: "request";
      id: string;
      method: "observe" | "action" | "street_view" | "perform";
      input: unknown;
    }
  | { type: "cancel"; id: string }
  | { type: "interrupt" }
  | { type: "error"; message: string }
  | { type: "trace"; name: string; detail: string }
  | { type: "screen"; screen: Screen };
