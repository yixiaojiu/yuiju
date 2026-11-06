import { type ToolExecutionOptions, tool } from "ai";
import { z } from "zod";

export type SkillTool = {
  description: string;
  inputSchema: z.ZodType;
  execute: (
    input: unknown,
    options: ToolExecutionOptions<Record<string, unknown>>,
  ) => Promise<unknown>;
};

/** 正文由注册方准备完成；工具归属当前节点，子节点通过唯一 ID 独立查询。 */
export type Skill = {
  id: string;
  description: string;
  content: string;
  tools: Readonly<Record<string, SkillTool>>;
  children: readonly Skill[];
};

/** 参数校验失败返回说明；业务异常正常抛出，执行参数由 schema 推导。 */
export function defineSkillTool<Schema extends z.ZodType>(definition: {
  description: string;
  inputSchema: Schema;
  execute: (
    input: z.output<Schema>,
    options: ToolExecutionOptions<Record<string, unknown>>,
  ) => unknown;
}) {
  return {
    ...definition,
    async execute(input: unknown, options: ToolExecutionOptions<Record<string, unknown>>) {
      const parsed = await definition.inputSchema.safeParseAsync(input);
      options.abortSignal?.throwIfAborted();
      if (!parsed.success) {
        return `输入错误：工具参数校验失败。\n${z.prettifyError(parsed.error)}`;
      }
      return await definition.execute(parsed.data, options);
    },
  };
}

/** 注册当前调用方的 Skill 树；索引只从树中派生，模型仅预先看到根节点简介。 */
export function registerSkills(skills: readonly Skill[]) {
  const contents = new Map<string, string>();
  const tools = new Map<string, SkillTool>();
  function register(skill: Skill): void {
    if (contents.has(skill.id)) {
      throw new Error(`Skill ID 重复：${skill.id}`);
    }
    contents.set(skill.id, skill.content);
    for (const [toolId, definition] of Object.entries(skill.tools)) {
      if (tools.has(toolId)) {
        throw new Error(`工具 ID 重复：${toolId}`);
      }
      tools.set(toolId, definition);
    }
    for (const child of skill.children) {
      register(child);
    }
  }
  for (const skill of skills) {
    register(skill);
  }

  const catalog = skills.map((skill) => `- ${skill.id}：${skill.description}`).join("\n");
  return {
    inspect: tool({
      description: [
        "你可以按 Skill ID 读取完整说明，也可以直接查询说明中提到的任意层级 ID。说明包含能力的使用方法和调用参数。",
        catalog ? `可用 Skill：\n${catalog}` : "当前没有可用 Skill。",
      ].join("\n"),
      inputSchema: z.strictObject({
        id: z.string().min(1).describe("你从入口目录或说明正文中获得的准确 Skill ID"),
      }),
      async execute({ id }, options) {
        options.abortSignal?.throwIfAborted();
        const content = contents.get(id);
        if (content === undefined) {
          return `输入错误：未注册的 Skill：${id}`;
        }
        return content;
      },
      toModelOutput: ({ output }) => ({ type: "text", value: output }),
    }),
    call_tool: tool({
      description:
        "你可以调用 Skill 说明中的具体工具。toolId 使用说明中提供的唯一工具标识，payload 按说明中的参数格式编写为 JSON 字符串。",
      inputSchema: z.strictObject({
        toolId: z.string().min(1).describe("你从 Skill 说明中获得的准确工具标识"),
        payload: z.string().describe("你按对应工具参数格式编写的 JSON 字符串"),
      }),
      async execute({ toolId, payload }, options) {
        options.abortSignal?.throwIfAborted();
        const definition = tools.get(toolId);
        if (!definition) {
          return `输入错误：未注册的工具：${toolId}`;
        }
        let input: unknown;
        try {
          input = JSON.parse(payload);
        } catch {
          return "输入错误：payload 不是合法的 JSON 字符串，请按工具说明中的参数格式填写。";
        }
        return await definition.execute(input, options);
      },
    }),
  };
}
