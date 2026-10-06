import type { PromptTemplate } from "../template";
export const plannerCompressionPrompt: PromptTemplate = {
  key: "conversation.plannerCompression",
  description: "整理群聊规划上下文，保留交流连续性和实际行动事实",
  template: `现在只整理以上旧摘要和已完成的完整交互，不选择或执行聊天行动。用简洁自然语言输出新的连续性摘要正文，不输出 Markdown 标题或 JSON。业务轮次可能尚未结束，你要保留当前正在处理的诉求与约束，让后续判断能继续。保留话题、重要人物与必要 id/sender-id、参与意图、必要判断依据、未完成事项、已表达立场和实际行动结果。区分打算、已发送、失败、结果不确定与尚未完成的事项。保留未完成交流所关联的事件 ID，区分事件投递与实际群消息发送。省略冗长推理和无关工具细节，不抄录全部历史。保留群友说法的归因，不把线上叙述写成共同生活事实，不补全未知经历。`,
};
