import { generateText } from "ai";
import { NICKNAME, SUBJECT_NAME } from "../../constants";
import { messageHistorySchemaPrompt } from "../../prompt";
import { flashModel } from "../models";

const SUBJECT_DISPLAY_NAME = `${SUBJECT_NAME}（${NICKNAME}）`;

export interface SummarizeConversationMessagesInput {
  scene: "group" | "private";
  sessionLabel: string;
  historyJson: string;
}

export interface DiarySummaryMaterial {
  type: string;
  happenedAt: string;
  content: string;
}

const summarizeConversationMessagesSystemPrompt = `
你正在总结一段已经结束的聊天对话。请用自然中文概括这段对话中大家聊了什么。

## 输出要求
1. 只输出一段摘要正文，不要标题、列表或解释。
2. 重点保留主要话题、用户提出的需求或问题、双方达成的结论、重要情绪、明确承诺和待跟进事项。
3. 可以忽略寒暄、重复表达、无关插曲和纯格式信息。
4. 不要编造，不要补充聊天记录中没有的信息。
5. 不要提到“聊天窗口”“消息记录”“摘要”“归档”等元信息。
6. 如果这段对话没有值得记住的内容，只输出“无”。
7. 尽量控制在 300 字以内。

会话名称只是上下文标识，不代表唯一发言者；真实发言者以消息项里的 \`speaker\` 字段为准。
总结具体观点、需求、情绪、承诺或待跟进事项时，请按对应消息项最外层的 \`speaker\` 归因。
摘要中提到群友昵称时，请使用 \`「昵称」\` 的格式包裹昵称，避免昵称和正文混在一起。

${messageHistorySchemaPrompt}
`.trim();

export async function summarizeConversationMessages(
  input: SummarizeConversationMessagesInput,
): Promise<string | null> {
  const result = await generateText({
    model: flashModel,
    system: summarizeConversationMessagesSystemPrompt,
    providerOptions: {
      flash: {
        enable_thinking: false,
      },
    },
    messages: [
      {
        role: "user",
        content: `
会话类型：${input.scene === "group" ? "群聊" : "私聊"}
会话名称：${input.sessionLabel}

聊天内容：
\`\`\`json
${input.historyJson}
\`\`\`
`.trim(),
      },
    ],
  });

  const summaryText = result.text.trim();
  if (!summaryText || summaryText === "无" || summaryText === "没有内容") {
    return null;
  }

  return summaryText;
}

export async function summarizeConversationDiaryMaterials(
  materials: DiarySummaryMaterial[],
): Promise<DiarySummaryMaterial> {
  const result = await generateText({
    model: flashModel,
    providerOptions: {
      flash: {
        enable_thinking: false,
      },
    },
    prompt: [
      "你是日记生成前的聊天素材压缩器。",
      "请把下面这些按时间排列的聊天摘要压成一段自然语言素材，供后续写日记使用。",
      "目标是帮助模型写出日记，不是做精确信息抽取，也不是复述每一段对话。",
      `这里的主角是${SUBJECT_DISPLAY_NAME}，两种叫法都指同一个人。`,
      `保留${SUBJECT_DISPLAY_NAME}当天聊过的重点、对话氛围、重要情绪、明确约定和可能会记住的小片段。`,
      "这些聊天摘要里可能包含时间范围，压缩时要保留一天中的大致时间顺序。",
      "如果聊天分布在上午、下午、晚上等不同时段，请自然带出这些时间线索。",
      "不要把全天聊天压成一段没有时间感的总括。",
      "不要输出条目列表，不要硬拆对象/话题/情绪字段，不要编造材料里没有的内容。",
      `聊天摘要：\n${JSON.stringify(materials)}`,
    ].join("\n"),
  });

  return {
    type: "conversation_summary",
    happenedAt:
      materials.at(-1)?.happenedAt ?? materials[0]?.happenedAt ?? new Date().toISOString(),
    content: result.text.trim(),
  };
}
