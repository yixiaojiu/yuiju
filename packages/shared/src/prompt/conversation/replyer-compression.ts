import type { PromptTemplate } from "../template";
export const replyerCompressionPrompt: PromptTemplate = {
  key: "conversation.replyerCompression",
  description: "整理真实聊天，保留后续表达需要的话题与人物语境",
  template: `现在只整理以上旧摘要和真实聊天，不生成发给群友的回复。用简洁自然语言输出新的交流摘要正文，不输出 Markdown 标题或 JSON。保留话题进展、人物指代与必要 id/sender-id、各方实际说过什么、必要原话、已经表达的立场和仍有效的语境。不要加入旧回复任务、内部规划、冗长推理或未发出的文字。保留线上说法的归因，不把玩笑、自称或约定写成已经发生的共同生活事实，不编造缺失信息。`,
};
