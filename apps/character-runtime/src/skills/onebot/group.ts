import { defineSkillTool, type Skill } from "@yuiju/shared/llm/skill-runtime";
import { z } from "zod";
import type { OnebotSkillDependencies } from "./skill";

export function createGroupSkill({
  api,
  groupId,
  groupName,
  groupWhitelistIds,
}: OnebotSkillDependencies): Skill {
  const definitions = {
    onebot_get_group_list: {
      content:
        "你可以查看当前账号参与且位于角色配置白名单中的群聊。payload 使用空对象的 JSON 字符串。返回 groups 和 current_group：groups 保留平台返回的群资料与顺序，只列白名单内的群；current_group 包含当前群的 group_id 和本轮开始时读取的 group_name。列表过滤不限制其他查询工具的跨群查询范围。",
      ...defineSkillTool({
        description: "查询白名单内已加入的群聊及当前群聊",
        inputSchema: z.strictObject({}),
        async execute() {
          const groups = await api.getGroupList();
          return {
            current_group: { group_id: groupId, group_name: groupName },
            groups: groups.filter((group) => groupWhitelistIds.includes(String(group.group_id))),
          };
        },
      }),
    },
    onebot_get_group_info: {
      content:
        "你可以查询指定群的名称、人数等平台资料。可以查询其他群，实际可见范围由当前账号的平台权限决定。",
      ...defineSkillTool({
        description: "查询群资料",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要查询的群号"),
          no_cache: z.boolean().optional().describe("你是否要求平台绕过缓存读取"),
        }),
        execute: ({ group_id, no_cache }) => api.getGroupInfo(group_id, no_cache),
      }),
    },
    onebot__get_group_notice: {
      content:
        "你可以读取指定群的公告列表，了解规则、通知或活动安排。接口原名为 _get_group_notice，因此工具名保留双下划线。",
      ...defineSkillTool({
        description: "读取群公告",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要阅读公告的群号"),
        }),
        execute: ({ group_id }) => api.getGroupNotice(group_id),
      }),
    },
    onebot_get_group_member_info: {
      content:
        "你可以查看指定群成员的平台资料，包括昵称、群名片、群内身份等。返回的是平台资料，不是你对这个人的记忆，也不会自动更新人物记忆。",
      ...defineSkillTool({
        description: "查询单个群成员资料",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要查询的群号"),
          user_id: z.string().min(1).describe("你要查询的成员 QQ 号"),
          no_cache: z.boolean().optional().describe("你是否要求平台绕过缓存读取"),
        }),
        execute: ({ group_id, user_id, no_cache }) =>
          api.getGroupMemberInfo(group_id, user_id, no_cache),
      }),
    },
    onebot_get_group_member_list: {
      content:
        "你可以读取指定群的成员列表，寻找提及的人或区分同名成员。列表可能很长，接口不提供本地关键词筛选；已知 QQ 号时优先读取单个成员。",
      ...defineSkillTool({
        description: "读取群成员列表",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要查询成员列表的群号"),
          no_cache: z.boolean().optional().describe("你是否要求平台绕过缓存读取"),
        }),
        execute: ({ group_id, no_cache }) => api.getGroupMemberList(group_id, no_cache),
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
    id: "onebot_group",
    description: "群列表、群资料、公告和成员资料",
    content: [
      "# 群资料与成员",
      "你可以先查看群列表；查询指定群时需要显式填写 group_id，并且可以跨群查询。调用 inspect 读取具体工具说明：",
      ...children.map((child) => `- ${child.id}：${child.description}`),
    ].join("\n\n"),
    tools: {},
    children,
  };
}
