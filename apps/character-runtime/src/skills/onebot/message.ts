import { defineSkillTool, type Skill } from "@yuiju/shared/llm/skill-runtime";
import { z } from "zod";
import type { OnebotSkillDependencies } from "./skill";

export function createMessageSkill(dependencies: OnebotSkillDependencies): Skill {
  const { api, groupId, selfId, beforeWrite, onMessageDeleted } = dependencies;
  const definitions = {
    onebot_get_msg: {
      content:
        "你可以读取已知消息 ID 对应的消息，补全引用内容。返回平台消息资料，包括发送者、时间、消息内容和所属群等字段。查询允许跨群，不会自动展开合并转发。",
      ...defineSkillTool({
        description: "读取指定消息",
        inputSchema: z.strictObject({
          message_id: z.string().min(1).describe("你要读取的消息 ID"),
        }),
        execute: ({ message_id }) => api.getMsg(message_id),
      }),
    },
    onebot_get_forward_msg: {
      content:
        "你可以通过合并转发资源的标识读取其中的消息节点。message_id 使用平台提供的合并转发资源 ID，不要凭空构造。返回节点列表；嵌套转发需要你按需继续查询。",
      ...defineSkillTool({
        description: "读取合并转发",
        inputSchema: z.strictObject({
          message_id: z.string().min(1).describe("你要展开的合并转发资源 ID"),
        }),
        execute: ({ message_id }) => api.getForwardMsg(message_id),
      }),
    },
    onebot_get_group_msg_history: {
      content:
        "你可以读取指定群的平台历史，补充聊天上下文，也可以查阅平台仍保留的旧消息。返回含 messages 的对象。message_seq 是平台消息序号，不是 message_id；可从消息查询结果取得。可选参数省略时由平台决定行为；reverseOrder 控制平台的历史查询方向。此接口不提供关键词搜索，不保证平台保存了全部历史。",
      ...defineSkillTool({
        description: "读取群消息历史",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要查询的群号，可以是其他群"),
          message_seq: z.number().int().optional().describe("你要以其为起点查询的平台消息序号"),
          count: z.number().int().positive().optional().describe("你希望平台返回的消息数量"),
          reverseOrder: z.boolean().optional().describe("你是否启用平台的反向历史查询"),
        }),
        execute: ({ group_id, message_seq, count, reverseOrder }) =>
          api.getGroupMsgHistory(group_id, message_seq, count, reverseOrder),
      }),
    },
    onebot_get_essence_msg_list: {
      content:
        "你可以读取指定群的精华消息列表，找到需要继续查询的消息标识。需要完整消息时再调用 onebot_get_msg。",
      ...defineSkillTool({
        description: "读取群精华消息列表",
        inputSchema: z.strictObject({
          group_id: z.string().min(1).describe("你要查看精华消息的群号"),
        }),
        execute: ({ group_id }) => api.getEssenceMsgList(group_id),
      }),
    },
    onebot_set_msg_emoji_like: {
      content: `你可以对当前群 ${groupId} 中的消息添加或取消表情回应。emoji_id 是平台表情标识，不是任意表情文字；set 为 true 表示添加，为 false 表示取消。执行前会查询消息并核对所属群，不能操作其他群的消息。返回平台操作结果。`,
      ...defineSkillTool({
        description: "添加或取消当前群消息的表情回应",
        inputSchema: z.strictObject({
          message_id: z.string().min(1).describe("你要回应的当前群消息 ID"),
          emoji_id: z.string().min(1).describe("你要使用的平台表情 ID"),
          set: z.boolean().describe("你要添加回应时填 true，取消回应时填 false"),
        }),
        async execute({ message_id, emoji_id, set }, options) {
          const message = await api.getMsg(message_id);
          if (message.message_type !== "group" || String(message.group_id) !== groupId) {
            throw new Error("只能回应当前群的消息");
          }
          options.abortSignal?.throwIfAborted();
          await beforeWrite();
          options.abortSignal?.throwIfAborted();
          return await api.setMsgEmojiLike(message_id, emoji_id, set);
        },
      }),
    },
    onebot_delete_msg: {
      content: `你可以撤回当前群 ${groupId} 中自己发送的消息，不能撤回其他群或其他发送者的消息。平台还可能因消息时限等原因拒绝撤回。成功后返回 message_id 和 deleted: true，并由调用方记录撤回事实；不会抹除原消息历史。`,
      ...defineSkillTool({
        description: "撤回当前群中自己的消息",
        inputSchema: z.strictObject({
          message_id: z.string().min(1).describe("你要撤回的当前群内自己发送的消息 ID"),
        }),
        async execute({ message_id }, options) {
          const message = await api.getMsg(message_id);
          if (message.message_type !== "group" || String(message.group_id) !== groupId) {
            throw new Error("只能撤回当前群的消息");
          }
          if (String(message.sender.user_id) !== selfId) {
            throw new Error("只能撤回当前账号发送的消息");
          }
          options.abortSignal?.throwIfAborted();
          await beforeWrite();
          options.abortSignal?.throwIfAborted();
          await api.deleteMsg(message_id);
          // 平台已确认撤回，即使此时取消，仍需记录已经发生的事实。
          await onMessageDeleted(message);
          return { message_id, deleted: true };
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
    id: "onebot_message",
    description: "消息、合并转发、历史、精华、表情回应和撤回",
    content: [
      "# 消息能力",
      "你可以调用 inspect 读取下列工具的详细说明：",
      ...children.map((child) => `- ${child.id}：${child.description}`),
    ].join("\n\n"),
    tools: {},
    children,
  };
}
