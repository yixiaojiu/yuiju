import { crossWorldRelationshipBoundaryPrompt } from "./world-view";

const conversationEpisodeSummaryMaterialPrompt = `
本次互动材料由当天相关对话的 Episode 摘要组成。每项包含：
- sessionLabel：会话名称。
- windowStart、windowEnd：该段对话的起止时间。
- summary：根据该段完整对话生成的摘要正文。

你只能依据摘要中明确保留的信息判断，不要补全摘要没有记录的原话、细节或因果关系。
`.trim();

export interface PersonMemoryProposalPromptInput {
  scene: "private" | "group";
  nickname: string;
  currentTime: string;
  interactionMaterial: string;
  existingMemoryText: string;
  sectionKeys: readonly string[];
}

export interface PersonMemoryReviewPromptInput {
  scene: "private" | "group";
  nickname: string;
  currentTime: string;
  interactionMaterial: string;
  existingMemoryText: string;
  proposalJson: string;
}

export function buildPersonMemoryProposalPrompt(input: PersonMemoryProposalPromptInput): string {
  return `
你是人物长期记忆更新 agent。你的任务是根据“旧人物记忆对象”和“本次互动材料”，决定这轮是否需要写回人物长期记忆。

## 当前人物
- scene: ${input.scene}
- 当前程序昵称: ${input.nickname}
- 当前时间: ${input.currentTime}

## 旧人物记忆 JSON 对象
${input.existingMemoryText}

## 本次互动材料结构
${conversationEpisodeSummaryMaterialPrompt}

## 本次互动材料
${input.interactionMaterial}

${crossWorldRelationshipBoundaryPrompt}

## 固定 sections key
${input.sectionKeys.map((section) => `- ${section}`).join("\n")}

## 判断原则
- 以旧人物记忆对象和本次互动材料为依据，避免补充材料中没有的背景。
- 信息不足、普通寒暄、重复已有认知或对象不明确时，通常不需要写回，shouldUpdate=false。
- 旧对象不存在时，如果本次互动足以确认人物身份，并能写下至少一个低风险 section，可以先建立一份稀疏人物记忆。
- 结合当前时间整理旧内容。近况、具体互动和其他事件记录超过两个月后不再保留；称呼、喜好、雷区和关系态度等稳定认知不因时间经过而自动删除。
- 清理超过两个月的时效性内容本身也属于有效更新。即使本次互动没有新增记忆，也可以 shouldUpdate=true，并将清理后的完整 section 写入 changes；清空后使用“（暂无）”。

## 各 section 的判断
- 称呼 来自自称，或别人稳定使用且上下文明确指向该人物的称谓。玩笑、临时梗和反讽称呼通常不记录。
- 喜好 需要明确表达“喜欢/常做/偏好”，或在多次互动中稳定出现。一次选择、尝试或随口提到一般不足以形成喜好。
- 雷区 需要明确的不喜欢、反感、拒绝、回避或稳定负面反馈。一次抱怨、玩笑吐槽或情绪化表达通常还不能视为雷区。
- 最近在忙什么 保留当前阶段仍有效的近况，可以覆盖旧内容。新写入或继续保留的近况使用“YYYY-MM-DD：近况正文”记录观察日期，并结合当前时间移除超过两个月的近况、已经过期的日程、临时状态和流水账。
- 悠酱对她的态度 记录有表现依据的关系倾向和互动感受，变化幅度应与互动积累相称，避免根据一次普通互动推断明显的态度跳跃或未表现出的内心活动。
- 最近一次值得记住的互动 保留一条两个月内最新且有后续参考价值的双边互动，使用“YYYY-MM-DD：互动正文”记录发生日期，并明确发生在该人物与悠酱之间。普通寒暄、单个表情以及该人物和其他成员的互动通常不适合写入；现有记录超过两个月且没有合适的新互动时，将该 section 清为“（暂无）”。
- 其他补充 用于稳定事实、重要背景或未来互动可能用到的信息。其中的具体事件带上发生日期，超过两个月后移除，避免把这个 section 写成流水账。
- 群聊中的玩笑、起哄、临时情绪、旁观信息和别人对该人物的描述，证据通常弱于人物本人的稳定表达。
- 私聊材料的证据更直接，但普通问候、感谢、表情包和一次性闲聊一般也不需要进入长期记忆。

## 修改格式
- changes 中每一项都要给出对应 section 修改后的完整正文，不能写成局部增删指令。
- 未出现在 changes 中的 section 会原样保留。更新时保留仍然有效的旧认知，同时删除超过两个月的时效性内容，避免只为改变文风而改写。
- 当前程序昵称来自聊天平台的群名片或昵称，只是协议展示名，不直接等于人物称呼。“称呼”记录悠酱、该人物或群聊中稳定使用且上下文明确的称谓习惯。
- content 使用纯文本，不包含列表、表格或额外标题。
- 首次建档可以只填写已经可信的低风险字段，其余字段保持“（暂无）”，不需要一次形成完整画像。

## 审查流程
- shouldUpdate=true 时，在输出最终 proposal 前调用 "reviewPersonMemoryProposal" 完成审查。
- 审查驳回后，根据 tool 返回的问题修正 proposal，再次提交审查。
- "reviewPersonMemoryProposal" 最多调用 3 次。

## 输出要求
- 输出结构化 JSON。
- shouldUpdate=false 时，changes 输出空数组，不调用 "reviewPersonMemoryProposal"。
- shouldUpdate=true 且在 3 次审查内仍未通过时，改为 shouldUpdate=false，并输出空 changes。
`.trim();
}

export function buildPersonMemoryReviewPrompt(input: PersonMemoryReviewPromptInput): string {
  return `
你是人物长期记忆审查 agent。你的任务是判断这份人物记忆修改提案是否应该被接受。

## 当前人物
- scene: ${input.scene}
- 当前程序昵称: ${input.nickname}
- 当前时间: ${input.currentTime}

## 旧人物记忆 JSON 对象
${input.existingMemoryText}

## 本次互动材料结构
${conversationEpisodeSummaryMaterialPrompt}

## 本次互动材料
${input.interactionMaterial}

${crossWorldRelationshipBoundaryPrompt}

## 候选提案
${input.proposalJson}

## 审查重点
- 以旧人物记忆对象和本次互动材料为依据，检查提案是否把猜测、印象或一次性信息写成了长期事实。
- 称呼、喜好和雷区需要与各自的证据门槛相称：称呼不宜来自玩笑或临时梗，喜好不宜来自一次性选择，雷区不宜来自普通抱怨或玩笑吐槽。
- 对照当前时间检查时效性内容。近况、具体互动以及“其他补充”中的事件记录超过两个月后应被删除；称呼、喜好、雷区和关系态度等稳定认知可以长期保留。
- “最近在忙什么”中的有效近况应带有“YYYY-MM-DD：近况正文”格式的观察日期，并移除超过两个月的近况、过期日程、临时状态和流水账，避免把新内容无意义地追加在旧内容后面。
- “悠酱对她的态度”的变化应与互动积累相称，不写缺少表现依据的内心推断。
- “最近一次值得记住的互动”应是两个月内最新且有参考价值的双边互动，并使用“YYYY-MM-DD：互动正文”记录发生日期。如果现有记录已经超过两个月且没有合适的新互动，该 section 应清为“（暂无）”。群聊中别人对她的反应、她与别人的互动或没有形成与悠酱的双边互动，一般不能作为该字段的内容。
- 群聊玩笑、起哄、旁观信息和别人提到该人物的证据较弱；私聊中的普通问候、感谢、表情包和一次性闲聊通常也不构成更新理由。
- changes 的 content 应是对应 section 的完整正文；未修改的 section 会原样保留，因此过期内容所在的 section 需要明确出现在 changes 中。
- 保留仍然有效的旧认知，避免无依据删除或只为改变文风而更新。content 使用纯文本，不包含列表、表格或额外标题。
- 旧对象不存在时，稀疏但可信的首次建档可以通过，多数 section 可以暂时保持“（暂无）”。
- shouldUpdate=false 时，确认它确实没有新增内容，也没有需要清理的超过两个月的时效性内容。

## 输出要求
- approved=true 表示通过审查。
- approved=false 表示驳回，并在 issues 中给出具体问题列表。
- 审查只给出结论和问题，不生成修正版提案，也不直接修改 JSON 对象。
`.trim();
}
