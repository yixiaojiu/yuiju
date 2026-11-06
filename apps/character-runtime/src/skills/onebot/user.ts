import { defineSkillTool, type Skill } from "@yuiju/shared/llm/skill-runtime";
import { z } from "zod";
import type { OnebotSkillDependencies } from "./skill";

export function createUserSkill({ api, beforeWrite }: OnebotSkillDependencies): Skill {
  const definitions = {
    onebot_get_stranger_info: {
      content:
        "你可以按 QQ 号查询用户的平台资料，不要求其属于当前群。可见信息由平台决定；查询不会自动改变你的人物记忆。",
      ...defineSkillTool({
        description: "查询用户平台资料",
        inputSchema: z.strictObject({
          user_id: z.string().min(1).describe("你要查询的用户 QQ 号"),
          no_cache: z.boolean().optional().describe("你是否要求平台绕过缓存读取"),
        }),
        execute: ({ user_id, no_cache }) => api.getStrangerInfo(user_id, no_cache),
      }),
    },
    onebot_get_login_info: {
      content: "你可以确认当前登录账号的 QQ 号和昵称。payload 使用空对象的 JSON 字符串。",
      ...defineSkillTool({
        description: "查询当前登录账号",
        inputSchema: z.strictObject({}),
        execute: () => api.getLoginInfo(),
      }),
    },
    onebot_set_self_longnick: {
      content:
        "你可以修改当前 QQ 账号的个性签名。这是账号全局操作，不是当前群专属资料：所有群共享签名，其他群的 Planner 也可能修改，最终值以平台实际执行结果为准。返回平台操作结果。",
      ...defineSkillTool({
        description: "修改当前账号的全局个性签名",
        inputSchema: z.strictObject({
          longNick: z.string().describe("你要设置的账号个性签名"),
        }),
        async execute({ longNick }, options) {
          await beforeWrite();
          options.abortSignal?.throwIfAborted();
          return await api.setSelfLongnick(longNick);
        },
      }),
    },
  };
  const children: Skill[] = Object.entries(definitions).map(([id, definition]) => ({
    id,
    description: definition.description,
    content: [
      `# ${id}`,
      definition.content,
      `调用 call_tool，toolId 为 ${id}，payload 为符合以下 schema 的 JSON 字符串：`,
      "```json",
      JSON.stringify(z.toJSONSchema(definition.inputSchema, { io: "input" }), null, 2),
      "```",
    ].join("\n\n"),
    tools: { [id]: definition },
    children: [],
  }));
  return {
    id: "onebot_user",
    description: "用户资料、当前账号和全局签名",
    content: [
      "# 用户与账号",
      "你可以读取用户资料或修改当前账号签名；签名修改会影响账号全局。调用 inspect 读取具体说明：",
      ...children.map((child) => `- ${child.id}：${child.description}`),
    ].join("\n\n"),
    tools: {},
    children,
  };
}
