import type { PromptTemplate } from "../template";

export const experiencePrompt: PromptTemplate = {
  key: "memory.experiences",
  description: "从实际经历材料整理可回忆的往事。",
  template: `请整理你实际经历的事情，每条记忆围绕相对完整的一件事，保留经过、当时感受和必要背景。只返回有依据的内容，并引用本批真实材料的 sourceIds。
区分他人转述、自己的打算、活动开始与实际完成，不把相同活动的开始、行动反馈和完成当成多次经历。不记录模型推理，不编造日期、人物或地点。没有值得留下的经历时可以返回空数组。`,
};

export const coarseMemoryPrompt: PromptTemplate = {
  key: "memory.coarsen",
  description: "将较细记忆归并成周、月或年层级的生活概括。",
  template: `请将给定的旧概括和新增往事整理为一个{{grain}}层级的生活概括。
周层级保留主要事情和感受；月层级保留生活节奏、反复发生的事情和重要变化；年层级只保留生活阶段与长期印象。不要把同一件事的多份描述当作多次发生，也不要凭空称某事为第一次。
合并重复信息，主动舍弃琐碎过程。不要沿用细节清单来假装抽象，不增加新事实。只输出简短自然语言，不输出标题或 JSON。`,
};

export const cognitionPrompt: PromptTemplate = {
  key: "memory.selfCognition",
  description: "根据近期实际经历更新对生活的认识，不改写核心人设。",
  template: `请根据旧认识和新增经历判断，你对近期生活的认识是否有实质变化。有变化才生成新的短篇正文；没有变化保持原文。
不要改写核心人设和世界观，不让角色随时间长大，不将新计划写成完成，不编造感悟。正文表达你最近过得怎么样，不代替情绪数值、人物画像或计划清单。`,
};

export const peoplePrompt: PromptTemplate = {
  key: "memory.people",
  description: "整理人物事实与关系感受，保留真实依据日期并主动遗忘。",
  template: `请结合原有认识、关联身份的认识和新增交流，整理你对这个人的画像。
facts 只保存对方提供的信息或有依据的事实；impressions 保存你的主观认识和关系感受，不把印象当成客观人格判断。
每条只引用一个直接支持这条认识的 sourceId；引用旧条目就保留旧日期，不能因为今天有了互动而刷新所有认识。合并重复内容，删除过时或不再重要的认识，每类最多 20 条。
短期近况使用 temporary，长期偏好和关系认识使用 lasting。关联身份不改变来源范围，不能将其他群的信息搬到本群的画像来源里。没有变化保持原有内容，不编造身份关联。`,
};
