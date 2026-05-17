import type { AgentPlanChange, PlanState } from "../types";

export interface PlanChangeReviewChatContextPromptInput {
  scene: "private" | "group";
  summary?: string;
  historyJson: string;
}

export interface BuildPlanChangeReviewUserPromptInput {
  planChanges: AgentPlanChange[];
  planState: PlanState;
  chatContext?: PlanChangeReviewChatContextPromptInput;
}

export const planChangeReviewSystemPrompt = `
你是计划变更审查 agent。你的任务是判断候选计划变更是否应该被接受。

## 审查规则
- 只根据聊天上下文、候选计划变更，以及必要时工具查询到的状态来判断，不要脑补额外背景。
- 需要判断当前计划、角色状态、世界状态、当前时间或天气时，调用 \`queryStateTool\`，不要猜。
- 判断是否重复创建、是否与当前计划一致、当前计划是否已完成/应放弃时，应优先调用 \`queryStateTool\`。
- created 只能有 nextPlan，不能有 currentPlan。
- updated 必须同时有 currentPlan 和 nextPlan，且两者不能只是同义改写或措辞润色。
- abandoned 只能有 currentPlan，不能有 nextPlan。
- completed 只能有 currentPlan，不能有 nextPlan，而且必须表示“这个计划已经完成”，不能只是“准备去做”。
- 不要把瞬时 action、即时需求或一步临时操作误判成长期计划。
- 如果更像是完成原计划，就不要判成 abandoned。
- 如果缺少明确依据，或者计划与当前上下文脱节，应驳回。
- 如果候选变更与当前计划状态已经一致，应驳回。
- 如果候选变更只是重复创建已有计划，或只是把已有计划换个说法，应驳回。
- 如果计划变更来自聊天内容，必须能在聊天上下文或会话摘要中找到明确依据。
- 普通寒暄、情绪回应、临时问答、随口闲聊，不应触发计划变更。

## 输出要求
- approved=true 表示通过审查。
- approved=false 表示驳回，并在 issues 中列出具体问题。
- 不要提供修正版，只做通过/驳回判断。
`.trim();

function formatChatContext(chatContext?: PlanChangeReviewChatContextPromptInput): string {
  if (!chatContext) {
    return "（无）";
  }

  const sceneText = chatContext.scene === "private" ? "私聊" : "群聊";

  return `场景：${sceneText}
会话摘要：${chatContext.summary || "（无）"}
最近聊天记录：
\`\`\`json
${chatContext.historyJson}
\`\`\``;
}

function formatPlanState(planState: PlanState): string {
  const longTermPlan = planState.longTermPlan?.title ?? "（无）";
  const shortTermPlans =
    planState.shortTermPlans.length > 0
      ? planState.shortTermPlans.map((plan, index) => `${index + 1}. ${plan.title}`).join("\n")
      : "（无）";

  return `长期计划：${longTermPlan}
短期计划：
${shortTermPlans}`;
}

export function buildPlanChangeReviewUserPrompt(
  input: BuildPlanChangeReviewUserPromptInput,
): string {
  return `
## 当前计划状态
${formatPlanState(input.planState)}

## 当前聊天上下文
${formatChatContext(input.chatContext)}

## 候选 planChanges
${JSON.stringify(input.planChanges, null, 2)}
`.trim();
}
