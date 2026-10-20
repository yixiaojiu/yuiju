import { truncateToolOutput } from "@yuiju/shared/llm/tool-output";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { AgentControl } from "../agent-loop/control";
import type { ExtensionRuntime } from "./runtime";

/** 只暴露当前角色启用的扩展能力；错误通过工具结果返回，不自动重试。 */
export function createExtensionTools(
  extensions: ExtensionRuntime,
  control: AgentControl,
  signal: AbortSignal,
): ToolSet {
  if (!extensions.loaded.agents.size) {
    return {};
  }
  return {
    inspect_agent: tool({
      description:
        "你可以查询扩展 agent 的详细说明。任务会提供输入 schema，场景会说明进入前需要准备的环境。",
      inputSchema: z.strictObject({
        agentId: z.string().min(1).describe("能力目录中的完整 agent 标识"),
      }),
      async execute({ agentId }) {
        try {
          signal.throwIfAborted();
          return JSON.stringify(extensions.inspect(agentId));
        } catch (error) {
          return `查询失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    call_agent: tool({
      description:
        "你可以委托任务型 agent。sync 等待结果，async 立即返回任务标识，完成后以事件交给你；任务失败不会自动重试。",
      inputSchema: z.strictObject({
        agentId: z.string().min(1).describe("能力目录中的完整任务 agent 标识"),
        mode: z.enum(["sync", "async"]),
        payload: z.string().describe("按照 inspect_agent 返回的输入 schema 编写的 JSON 字符串"),
      }),
      async execute({ agentId, mode, payload }) {
        try {
          return JSON.stringify(await extensions.call(agentId, mode, payload, signal));
        } catch (error) {
          return `任务未提交：${error instanceof Error ? error.message : String(error)}`;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
    }),
    enter_scene: tool({
      description:
        "你准备好场景所需环境后，可以申请进入。当前步骤完成后暂停你的决策，等待用户主动进入并由扩展确认；工具返回不表示已进入。进入失败或场景结束后，你会收到结果事件并恢复决策。",
      inputSchema: z.strictObject({
        agentId: z.string().min(1).describe("能力目录中的完整场景 agent 标识"),
        context: z
          .string()
          .optional()
          .describe("交接上下文：用户意图、已完成的准备及场景需要了解的情况"),
      }),
      async execute({ agentId, context }) {
        try {
          signal.throwIfAborted();
          return JSON.stringify(control.requestEntry(agentId, context));
        } catch (error) {
          return `进入请求未提交：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
  };
}
