import type { z } from "zod";
import type { PromptTemplate } from "../prompt/template";
import type { JsonValue, WorldEvent } from "../world/protocol";

/** 每角色、每扩展独立装配；只提供身份与该扩展校验后的配置。 */
export type ExtensionContext<Config> = {
  readonly character: Readonly<{ id: string; name: string }>;
  readonly config: Readonly<Config>;
};

export type TaskExecution = { taskId: string; signal: AbortSignal };
export type TaskInstance<Input> = {
  run(input: Input, execution: TaskExecution): Promise<JsonValue>;
  dispose?(): Promise<void>;
};

export type SceneExecution = { sessionId: string; signal: AbortSignal };
export type SceneEntryResult = { status: "confirmed" } | { status: "rejected"; reason: string };
export type SceneRoundResult =
  | { status: "continue" }
  | { status: "exit"; reason: string; context?: string };

/** 自定义输入包在 extension 事件内，不能冒充世界通知或宿主生命周期。 */
export type SceneEvent = { id: string; occurredAt: number } & (
  | { type: "scene_entered"; payload: { context?: string } }
  | { type: "world"; payload: WorldEvent }
  | { type: "activity_due"; payload: { activityId: string; endsAt: number } }
  | { type: "plan_attention"; payload: { planId: string; revision: number; attentionAt: number } }
  | { type: "plan_review"; payload: { planId: string; revision: number } }
  | { type: "extension"; payload: JsonValue }
);

export type SceneInstance = {
  /** 只有用户主动进入且扩展准备完成才确认；取消信号同时覆盖等待用户的时间。 */
  waitForEntry(context: string | undefined, execution: SceneExecution): Promise<SceneEntryResult>;
  /** 宿主串行交付固定批次；普通工具不代表结束，退出时显式返回 exit。 */
  handleEvents(events: SceneEvent[], execution: SceneExecution): Promise<SceneRoundResult>;
  dispose(): Promise<void>;
};

type AgentDescription = {
  id: string;
  description: string;
  instructions?: string;
};

export type TaskAgentDefinition<Config, Input = unknown> = AgentDescription & {
  type: "task";
  inputSchema: z.ZodType<Input>;
  resultDescription: string;
  create(context: ExtensionContext<Config>): TaskInstance<Input>;
};

export type SceneAgentDefinition<Config> = AgentDescription & {
  type: "scene";
  pauseConversation?: boolean;
  worldEvents?: WorldEvent["type"][];
  eventSchema?: z.ZodType<JsonValue>;
  create(context: ExtensionContext<Config>): SceneInstance;
};

export type AgentDefinition<Config> = TaskAgentDefinition<Config> | SceneAgentDefinition<Config>;

/** agent.ts 的默认导出；声明加载阶段不创建实例、不调用模型。 */
export type ExtensionDefinition<Config = unknown> = {
  configSchema: z.ZodType<Readonly<Config>>;
  agents: AgentDefinition<Config>[];
  prompts?: readonly PromptTemplate[];
};

export type ExtensionImport = {
  extension: string;
  load(): Promise<{ default: ExtensionDefinition }>;
};

export type ExtensionTaskResult = { taskId: string; agentId: string } & (
  | { status: "completed"; result: JsonValue }
  | { status: "failed"; error: string }
);

/** failed 表示未能进入；ended 表示已进入后结束。两者均只作为 main 的新输入。 */
export type ExtensionSceneResult = {
  agentId: string;
  sessionId: string;
  status: "failed" | "ended";
  reason: string;
  context?: string;
};
