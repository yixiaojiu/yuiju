import { NICKNAME, SUBJECT_NAME } from "../constants";

export interface MessageHistoryUserPromptInput {
  summary?: string;
  historyJson: string;
  latestMessageDirectedType?: "at" | "reply";
}

export interface MessageSummaryPromptInput {
  sessionLabel: string;
  previousSummary?: string;
  transcript: string;
}

export const messageHistorySchemaPrompt = `
## 历史消息结构
历史消息是按时间从旧到新排列的 JSON 数组。

数组中的每一项表示一条真实发送出去的聊天消息：
- \`speaker\`：这条消息的真实发言者展示名；如果是${SUBJECT_NAME}(${NICKNAME})，表示这是你自己之前发出的消息
- \`time\`：这条消息的发送时间
- \`content\`：这条消息包含的消息段数组；一条消息可能由文本、@、引用、图片或表情等多个段组成

读取一条消息时，请先确认这一项最外层的 \`speaker\`，再阅读 \`content\` 中的各个消息段。消息段只描述这条消息的内容或附带动作，不会改变这条消息的真实发言者。

常见消息段：
- \`text\`：文本段，读取 \`data.text\`
- \`at\`：@ 提及段，表示这条消息提到了某个对象；\`data.displayName\` 是被提到的人或全体成员
- \`reply\`：引用回复段，表示这条消息引用了另一条历史消息；\`data.speaker\` 是被引用消息当时的发言者，\`data.content\` 是被引用消息的内容
- \`image\`：图片或表情图片段，优先读取 \`data.description\` 作为图片内容描述
- \`face\`：QQ 表情段，读取 \`data.faceText\`

除了上面列出的字段，其他字段通常是平台协议细节。只有在它们对理解对话内容明显有帮助时才参考。

`.trim();

export const chatReplyRulesPrompt = `
## 聊天回复规则
先判断最新消息是否需要回复，再决定回复内容。
这是通讯软件里的线上聊天场景，回复内容要像真实会发出去的聊天消息，而不是小说台词、舞台剧脚本或角色扮演旁白。
不要用括号描写动作、神态、姿势、内心旁白或舞台说明；这些反应要么转成自然口语，要么直接省略。
聊天回复要克制，不要每条都回，也不要打断自然对话节奏。
当最新消息明确提问、请求回应、直接 @、引用回复，或上下文正在自然邀请参与时，更倾向回复。
当最新消息只是闲聊片段、情绪宣泄、表情或图片反应、话题已经自然结束、当前接不上话，或回复会显得多余时，不要回复。
`.trim();

/**
 * 构建消息场景共用的历史上下文提示词。
 *
 * 说明：
 * - 滚动摘要与结构化历史分章节提供，避免模型把摘要误判成真实消息项；
 * - 历史 JSON 只承载消息投影，不混入额外控制信息。
 */
export function buildMessageHistoryUserPrompt(input: MessageHistoryUserPromptInput): string {
  let latestMessageDirectedDescription = "null";

  switch (input.latestMessageDirectedType) {
    case "at":
      latestMessageDirectedDescription = "这条最新消息显式 @ 了当前角色。";
      break;
    case "reply":
      latestMessageDirectedDescription = "这条最新消息使用 reply 引用回复当前角色。";
      break;
  }

  return `
## 最近会话摘要
${input.summary || "null"}

## 最新消息补充上下文

${latestMessageDirectedDescription}

## 历史会话消息

\`\`\`json
${input.historyJson}
\`\`\`
`;
}

/**
 * 构建聊天场景的计划提案提示词。
 *
 * 说明：
 * - 聊天模型只能提交计划变更提案，不能确认计划已经生效；
 * - 真正的审查、应用和记忆写入由后台链路处理。
 */
export function buildChatPlanProposalPrompt(): string {
  return `
## 聊天计划提案规则
只有当聊天内容明确影响你后续安排时，才调用 \`proposePlanChanges\` 提交计划变更提案。
当你需要判断当前计划，或准备提交计划变更提案时，必须先调用 \`queryStateTool\` 查看当前计划状态；不要凭聊天上下文猜当前计划。
普通聊天、情绪回应、临时问答、寒暄和随口闲聊，不要调用 \`proposePlanChanges\`。
\`proposePlanChanges\` 只表示提案已提交后台审查，不代表计划已经更新成功。
调用工具后，不要对用户说“计划已更新”“已加入计划”“已经安排好”等确认生效的话。
\`proposePlanChanges\` 只能调用一次
`.trim();
}

/**
 * 构建滚动摘要生成提示词。
 */
export function buildMessageSummaryPrompt(input: MessageSummaryPromptInput): string {
  return `你是聊天历史摘要器，请把“既有历史摘要”和“本轮新增对话”整合成一段新的滚动摘要。
要求：
1. 只输出摘要正文，不要标题、不要列表、不要额外解释。
2. 使用自然中文，尽量控制在 200 字以内。
3. 优先保留稳定事实、最近持续话题、明确情绪变化、待跟进事项。
4. 不要编造，不要把无关寒暄写进去。
5. 如果目前没有值得保留的上下文，只输出“无”。
会话：${input.sessionLabel}
既有历史摘要：${input.previousSummary ?? "无"}
本轮新增对话：
${input.transcript}`;
}
