import type { z } from "zod";
import type { PromptTemplate } from "../prompt/template";
import type { CurrentWorldView, JsonValue } from "../world/protocol";

/** 每角色、每扩展独立装配；宿主只提供角色身份，配置由扩展自行管理。 */
export type ExtensionContext = {
  readonly character: Readonly<{ id: string; name: string }>;
};

export type TaskExecution = { taskId: string; signal: AbortSignal };
export type TaskInstance<Input> = {
  run(input: Input, execution: TaskExecution): Promise<JsonValue>;
  dispose?(): Promise<void>;
};

export type SceneExecution = {
  sessionId: string;
  signal: AbortSignal;
  /** 扩展的页面连接入口已就绪，可以让用户连接并确认进入。 */
  ready(): void;
};
export type SceneEntryResult = { status: "confirmed" } | { status: "rejected"; reason: string };
export type SceneResult = { reason: string; context?: string };

export type SceneInstance = {
  /** 只有用户主动进入且扩展准备完成才确认；取消信号同时覆盖等待用户的时间。 */
  waitForEntry(context: string | undefined, execution: SceneExecution): Promise<SceneEntryResult>;
  /** 自行管理输入和完整 loop，直到场景结束才返回；signal 取消时须结束在途操作并退出。 */
  run(execution: SceneExecution): Promise<SceneResult>;
  dispose(): Promise<void>;
};

type AgentDescription = {
  id: string;
  /**
   * 能力简介：加入主 agent 的固定提示词目录，每次请求都会携带，帮助判断何时使用。
   * inspect_agent 也会返回此字段；不会自动注入扩展自身模型的提示词。
   */
  description: string;
  /**
   * 详细使用说明：主 agent 调用 inspect_agent 时通过工具结果按需读取，不加入固定提示词。
   * 说明适用场景、进入条件和准备步骤；不会自动注入扩展自身模型的提示词。
   */
  instructions?: string;
};

export type TaskAgentDefinition<Input = unknown> = AgentDescription & {
  type: "task";
  inputSchema: z.ZodType<Input>;
  resultDescription: string;
  create(context: ExtensionContext): TaskInstance<Input>;
};

export type SceneAgentDefinition = AgentDescription & {
  type: "scene";
  /** 主 agent 申请及正式交接时检查；返回不能进入的原因，null 表示允许。 */
  checkEntry?(world: CurrentWorldView): string | null;
  pauseConversation?: boolean;
  create(context: ExtensionContext): SceneInstance;
};

export type AgentDefinition = TaskAgentDefinition | SceneAgentDefinition;

/** agent.ts 的默认导出；声明加载阶段不创建实例、不调用模型。 */
export type ExtensionDefinition = {
  agents: AgentDefinition[];
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
