import type { PromptTemplate } from "../template";

export const pausedConversationPrompt: PromptTemplate = {
  key: "conversation.paused",
  description: "角色暂停参与期间的群聊背景整理，不生成追补回复。",
  template: `你暂时没有参与群聊。请结合已有背景，整理暂停期间实际发生的交流，供你稍后理解新消息。
只写简短自然语言摘要。保留话题、参与者及必要的关系变化，分清成员转述、玩笑与实际发生的事。不要代替你接受安排，不把群聊转述当作你的亲历，不生成回复或补答建议。没有实质变化时保留原背景。`,
};
