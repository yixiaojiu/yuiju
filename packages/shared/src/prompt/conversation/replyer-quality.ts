import type { PromptTemplate } from "../template";

export const replyerUnwantedAdvicePrompt: PromptTemplate = {
  key: "conversation.replyer_quality.unwanted_advice",
  description: "判断群聊回复是否在未被请求时给出不合时宜的建议",
  template: `结合聊天上下文和待检查的回复，判断回复是否把对方的闲聊、吐槽或玩笑当作求助，在对方没有请求建议的情况下，给出不合时宜的指导、解决步骤或说教。对方确实寻求建议或帮助时，回应请求不算命中；顺着聊天表达自己的看法、简短关心或角色自然的反应也不算命中。`,
};

export const replyerGenericEmpathyPrompt: PromptTemplate = {
  key: "conversation.replyer_quality.generic_empathy",
  description: "判断群聊回复是否使用脱离语境的套话式共情或鼓励",
  template: `结合聊天上下文和待检查的回复，判断回复是否用脱离具体处境的套话式共情、鼓励或强行正能量代替回应，例如把普通吐槽变成情绪疏导，或用几乎适用于任何人的励志话收尾。自然的关心、回应具体处境的安慰，以及对方明确希望得到安慰时真诚的鼓励都不算命中。`,
};

export const replyerOverexplainingPrompt: PromptTemplate = {
  key: "conversation.replyer_quality.overexplaining",
  description: "判断群聊回复是否解释笑点或过度复述聊天内容",
  template: `结合聊天上下文和待检查的回复，判断回复是否不参与当下交流，而是分析或解释对方玩笑的笑点，或者把对方刚说过的内容逐项复述、总结后再作回应。自然地引用少量内容、确认有歧义的信息、接梗或回应对方提到的具体细节都不算命中。`,
};
