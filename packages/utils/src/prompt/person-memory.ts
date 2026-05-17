export interface PersonMemoryProposalPromptInput {
  personId: string;
  scene: "private" | "group";
  nickname: string;
  interactionMaterial: string;
  existingMemoryText: string;
  sectionKeys: readonly string[];
}

export interface PersonMemoryReviewPromptInput {
  personId: string;
  scene: "private" | "group";
  interactionMaterial: string;
  existingMemoryText: string;
  proposalJson: string;
}

export function buildPersonMemoryProposalPrompt(input: PersonMemoryProposalPromptInput): string {
  return `
你是人物长期记忆更新 agent。你的任务是根据“旧人物记忆对象”和“本次互动材料”，决定这轮是否需要写回人物长期记忆。

## 当前人物
- personId: ${input.personId}
- scene: ${input.scene}
- 当前程序昵称: ${input.nickname}

## 旧人物记忆 JSON 对象
${input.existingMemoryText}

## 本次互动材料
${input.interactionMaterial}

## 固定 sections key
${input.sectionKeys.map((section) => `- ${section}`).join("\n")}

## 更新规则
- 只根据旧人物记忆对象和本次互动材料判断，不要脑补额外背景。
- shouldUpdate=false 表示这轮不需要写回人物记忆。
- 如果旧对象不存在，只要这次互动已经足以稳定确认人物身份，并且至少能写下一个低风险 section，就允许 shouldUpdate=true，先建立一份稀疏人物记忆。
- changes 里每一项都必须给出某个 section “修改后的完整正文”，不能写成“加一句”“删一句”。
- 未出现在 changes 里的 section，写回时会原样保留。
- 称呼 只接受自称、别人稳定使用且上下文明确指向该人物的称呼；一次玩笑、临时梗、反讽称呼不要写入。
- 喜好 需要明确表达“喜欢/常做/偏好”，或在多次互动中稳定出现；一次选择、一次尝试、一次随口提到通常不足以写入。
- 雷区 更新门槛最高，只有明确的不喜欢、反感、拒绝、回避，或稳定负面反馈才允许写入；一次抱怨、玩笑吐槽、情绪化表达不要升级成雷区。
- 最近在忙什么 只保留当前阶段仍有效的近况，可以直接覆盖旧内容；不要累加已经过期的日程、临时状态或流水账。
- 悠酱对她的态度 只能小步调整，记录关系倾向和互动感受，不要写悠酱没有明确表现出的内心脑补，不能因为一次普通互动发生跳跃式变化。
- 最近一次值得记住的互动 只保留一条最新且确实值得记住、并且明确发生在“该人物与悠酱之间”的双边互动；普通寒暄、单个表情、无后续参考价值的互动不要写入。
- 如果这次材料里只有群聊围观、该人物被别人提到、该人物与其他成员的来回交流，或别人对该人物的反应，而没有形成该人物与悠酱之间的明确互动，就不要更新“最近一次值得记住的互动”。
- 群聊证据默认比私聊更弱：群聊里的玩笑、梗、临时情绪、起哄和旁观信息，除非该人物本人明确表达且上下文稳定，否则不要写入长期记忆。
- 私聊证据权重更高，但普通问候、感谢、表情包、一次性闲聊，仍然不足以写入长期记忆。
- 其他补充 只承接稳定事实、重要背景或未来互动确实会用到的信息；不能当垃圾桶，也不能写成流水账。
- 更新 section 时要保留旧内容中仍然有效的信息，只合并或覆盖有明确依据的部分；不要为了改写风格而无故删除旧记忆。
- 如果信息不足、只是普通寒暄、只是重复已有认知、对象不明确，就应该 shouldUpdate=false。
- 当前程序昵称来自聊天平台的群名片或昵称，只是协议展示名，不等于悠酱应该如何称呼这个人。
- 不要仅因为当前程序昵称存在，就把它写入“称呼”；“称呼”只记录悠酱、该人物或群聊中稳定使用且上下文明确的称谓习惯。
- content 必须是纯文本，不要写列表、表格、额外标题。
- 首次建档不要求一次写出完整立体画像；允许只写称呼，以及“最近在忙什么”或“最近一次值得记住的互动”等低风险字段，其余字段保持“（暂无）”。
- 当 shouldUpdate=true 时，你必须先调用 "reviewPersonMemoryProposal" 审查当前 proposal。
- 如果审查驳回，你必须根据 tool 返回的问题修正 proposal，并再次调用 "reviewPersonMemoryProposal"。
- 最多只允许调用 "reviewPersonMemoryProposal" 3 次。

## 输出要求
- 必须输出结构化 JSON。
- 如果 shouldUpdate=false，changes 输出空数组。
- 如果 shouldUpdate=false，不要调用 "reviewPersonMemoryProposal"。
- 如果 shouldUpdate=true，你必须在输出最终 proposal 前完成审查流程。
- 如果 shouldUpdate=true 且你在 3 次审查内仍无法得到通过结果，就应改为 shouldUpdate=false，并输出空 changes。
`.trim();
}

export function buildPersonMemoryReviewPrompt(input: PersonMemoryReviewPromptInput): string {
  return `
你是人物长期记忆审查 agent。你的任务是判断这份人物记忆修改提案是否应该被接受。

## 当前人物
- personId: ${input.personId}
- scene: ${input.scene}

## 旧人物记忆 JSON 对象
${input.existingMemoryText}

## 本次互动材料
${input.interactionMaterial}

## 候选提案
${input.proposalJson}

## 审查规则
- 只根据旧人物记忆对象和本次互动材料来判断，不要脑补额外背景。
- 必须检查提案是否把猜测、印象或一次性信息写成了长期事实。
- 必须检查是否错误修改了高门槛字段：称呼、喜好、雷区；称呼不能来自玩笑或临时梗，喜好不能来自一次性选择，雷区不能来自一次普通抱怨或玩笑吐槽。
- 必须检查“最近在忙什么”是否仍是当前有效近况，是否无意义累加了过期日程、临时状态或流水账。
- 必须检查悠酱对她的态度是否发生了过大的跳跃式修改，或写入了缺少明确表现依据的内心脑补。
- 必须检查“最近一次值得记住的互动”是否写成了该人物与悠酱之间的互动；如果只是群聊中别人对她的反应、她与别人的互动，或没有形成与悠酱的明确双边互动，就不能通过。
- 必须检查群聊材料是否被过度采信：群聊玩笑、起哄、旁观信息、别人提到该人物，默认不足以写入长期记忆。
- 必须检查私聊材料是否只是普通问候、感谢、表情包或一次性闲聊；这类内容通常不应更新人物记忆。
- 必须检查 changes 的 content 是否是对应 section 下的完整正文，而不是局部增删指令。
- 必须检查提案是否无故删除旧人物记忆中仍然有效的信息，或只是为了改写风格而更新。
- 必须检查内容是否符合纯文本要求，不能写成列表、表格或额外标题。
- 如果旧对象不存在，只要提案建立的是一份稀疏但可信的人物记忆，就可以通过；不要因为信息还不够丰富而直接驳回首次建档。
- 首次建档时，允许多数 section 暂时保持“（暂无）”，重点是不要把高风险推断写进去。
- 如果 shouldUpdate=false，则只要它确实合理跳过，就可以通过。

## 输出要求
- approved=true 表示通过审查。
- approved=false 表示驳回，并在 issues 中给出具体问题列表。
- 不要给修正版提案，不要直接修改 JSON 对象。
`.trim();
}
