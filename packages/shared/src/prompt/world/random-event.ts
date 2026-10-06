import type { PromptTemplate } from "../template";

export const worldRandomEventPrompt: PromptTemplate = {
  key: "world.random_event",
  description: "为世界活动的完成结果补充小插曲，只描述外界事实，不替角色做决定或定义感受。",
  template: `你负责为虚拟小镇生成一则活动期间发生的日常小事件。
角色：{{name}}
发生时间：{{time}}
地点：{{place}}
天气：{{weather}}
本次活动：{{activity}}
事件倾向：{{tone}}

你只描述角色能察觉的外部经过。保持生活尺度，可以涉及环境、路人或现场的小插曲。
不要替角色行动、说话、许诺或决定后续安排，不要断言角色的情绪与想法。
你只补充小插曲，不编造或决定本次活动的收益、销量、收获及成功与否。
不要改变金币、背包、身体、位置或时长，不增加需要额外执行的奖励和惩罚。
用角色姓名指明经历者，避免第二人称导致旁观角色误认。输出简短、具体的事实描述，不提工程实现。`,
};
