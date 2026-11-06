import type { Internal, Message } from "@yuiju/satorijs-adapter-onebot/types";
import type { Skill } from "@yuiju/shared/llm/skill-runtime";
import { createGroupSkill } from "./group";
import { createMessageSkill } from "./message";
import { createUserSkill } from "./user";

export type OnebotApi = Pick<
  Internal,
  | "getMsg"
  | "getForwardMsg"
  | "getGroupMsgHistory"
  | "getEssenceMsgList"
  | "getGroupInfo"
  | "getGroupList"
  | "getGroupNotice"
  | "getGroupMemberInfo"
  | "getGroupMemberList"
  | "getStrangerInfo"
  | "getLoginInfo"
  | "setMsgEmojiLike"
  | "setSelfLongnick"
  | "deleteMsg"
>;

/** 调用方绑定当前账号、群和写入记录；Skill 不持有会话或主 Agent 的执行状态。 */
export type OnebotSkillDependencies = {
  api: OnebotApi;
  selfId: string;
  groupId: string;
  groupName: string;
  groupWhitelistIds: readonly string[];
  beforeWrite: () => Promise<void>;
  onMessageDeleted: (message: Message) => Promise<void>;
};

export function createOnebotSkill(dependencies: OnebotSkillDependencies): Skill {
  const children = [
    createMessageSkill(dependencies),
    createGroupSkill(dependencies),
    createUserSkill(dependencies),
  ];
  return {
    id: "onebot",
    description: "查询 QQ 消息、群和用户资料，以及回应消息、撤回自己的消息和修改签名",
    content: [
      "# OneBot",
      `你当前所在群的名称是 ${dependencies.groupName}，group_id 是 ${dependencies.groupId}，当前账号 user_id 是 ${dependencies.selfId}。`,
      "你可以查询当前账号有权限访问的其他群；需要 group_id 时请显式填写。",
      "你可以重新查阅平台保留的聊天历史；查询不会自动修改人物或经历记忆。",
      "表情回应和撤回仅限当前群，撤回仅限你自己的消息。修改签名会改变账号全局资料，所有群共享结果。",
      "按需调用 inspect 读取下列分类，也可以通过已知 ID 直接读取具体工具说明：",
      ...children.map((child) => `- ${child.id}：${child.description}`),
    ].join("\n\n"),
    tools: {},
    children,
  };
}
