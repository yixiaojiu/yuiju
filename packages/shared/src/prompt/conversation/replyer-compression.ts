import type { PromptTemplate } from "../template";
export const replyerCompressionPrompt: PromptTemplate = {
  key: "conversation.replyerCompression",
  description: "整理真实聊天，保留后续表达需要的话题与人物语境",
  template: `现在你只整理以上旧摘要和真实聊天，不生成发给群友的回复。用简洁自然语言输出新的交流摘要正文，不输出 Markdown 标题或 JSON。合并旧摘要后的新摘要总长度不超过 500 字，不必凑满。重新整合旧摘要与本批聊天，优先保留仍在延续的话题、未解决的问题、关键事实、人物指代与必要 id/sender-id、各方已经表达的立场和必要原话。删去已经结束且不再影响当前交流的内容，合并重复信息，不逐轮累加旧摘要。不要加入旧回复任务、内部规划、冗长推理或未发出的文字。保留线上说法的归因，不把玩笑、自称或约定写成已经发生的共同生活事实，不编造缺失信息。`,
};
