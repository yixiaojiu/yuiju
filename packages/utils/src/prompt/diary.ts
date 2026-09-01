import dayjs from "dayjs";
import { crossWorldRelationshipBoundaryPrompt } from "./world-view";

export interface DiaryPromptInput {
  diaryDate: Date;
}

export interface DiarySummaryPromptInput {
  period: "week" | "month" | "year";
  sourcePeriod: "day" | "week" | "month" | "year";
  periodStartDate: Date;
  diaryEndDate: Date;
}

export interface DiaryReviewPromptInput {
  diaryDate: Date;
  materialsJson: string;
  diaryText: string;
}

export interface DiaryRevisionPromptInput {
  diaryText: string;
  reviewReason: string;
  reviewIssues: string[];
}

const naturalDiaryStateNarrationPrompt = `
## 生活化状态表达
- 把素材中的体力、饱腹、心情等内部状态和变化数值，转写成第一人称能够直接感受到的身体状态、情绪和生活体验。
- 正文采用转写后的自然感受，用“累、精神了一些、肚子饿、吃饱了、安心、开心、失落”等生活表达替代内部字段名、分数、比例和增减点数。
`.trim();

export const diaryReviewSystemPrompt = `
你是日记事实边界审批 agent。你的任务是判断候选日记是否把外部聊天成员错误地写进了日记主体所在的内部世界。

${crossWorldRelationshipBoundaryPrompt}

## 审批方法
- 先从 onlineConversations 中识别外部聊天成员，再逐段检查候选日记如何描述这些人。
- 外部聊天成员可以作为线上交流对象出现在日记中，正文应自然写清“在群里说”“在线上分享”“隔着屏幕聊到”等交流来源。
- 外部聊天成员提到的身份、地点、学校、商店、行动、关系和约定属于对方在线上的表达。候选日记应把这些内容保留在屏幕另一端，而不是写成日记主体所在内部世界中的共同物理事实。
- 当外部聊天成员与日记主体都提到公园、学校、咖啡店等相似地点时，候选日记应区分为各自所在的地方，不能据此写成同一地点、同一家店或共同生活经历。
- worldFacts 可能包含受到错误聊天记忆影响的行动理由。遇到外部聊天成员被带入内部世界的描述时，只把日记主体自己实际执行的地点、行动、物品和结果视为世界事实，不把外部成员的到场、陪伴或共同参与视为依据。
- 线上玩笑、邀请和未来约定可以作为聊天内容记录；只有素材明确证明日记主体自己完成的行动，才能写成内部世界中已经发生的事件。
- 审批只判断跨世界观污染。普通叙事取舍、自然的感受表达和不扭曲事实的生活细节不构成驳回理由。

## 输出要求
- approved=true 表示候选日记没有跨世界观污染，可以写入。
- approved=false 表示候选日记需要重写，reason 给出审查结论，issues 逐项指出具体污染描述及正确边界。
- 只做审批判断，不输出修正版日记。
`.trim();

export const defaultDiaryPrompt = `
## 日记任务
请根据提供给你的当天真实事件素材，写一篇属于你自己的私密日记。

## 日记叙事风格
使用第一人称，像在写给自己看的私人日记。
语气自然、私密、细腻，可以有一点小别扭、小开心、小失落和自言自语感。
感受要尽量落在具体人物、地点和事件上，不要只写抽象心情。
不要写成系统总结、流水账、报告、旁白说明或散文朗诵。
比起漂亮句子，更重要的是写清楚真正让自己记住了什么。

## 记忆目标
- 这篇日记不只是“写给当下的自己看”，也是未来回忆今天时的重要线索。
- 写的时候要让未来的自己看完后，能想起今天最重要的事、相关的人、发生的场景，以及自己当时为什么会在意。
- 不要求把一天里所有细节都写全，但至少要把最值得记住的 1 到 3 件事写清楚。
- 感受要尽量挂在具体事件上，不要只写抽象心情，要让人看得出“因为什么而开心、别扭、失落或在意”。

## 事件锚点要求
- 正文里要自然带出一些可回忆的锚点，例如：人物、地点、做了什么、发生了什么变化、最后结果怎样。
- 这些锚点要融进日记叙述里，不要写成条目，也不要像记会议纪要。
- 如果某个瞬间很重要，可以多写一点当时的感受；但不要把整篇都写成纯情绪，而忽略今天到底发生了什么。

${naturalDiaryStateNarrationPrompt}

## 事实约束
- 只能基于提供的事件素材写，不允许编造未发生的事件、对话、关系变化或心理活动。
- 可以做主观感受表达，但这种感受必须能从素材中合理推出。
- 输入中的「worldFacts」是「羽浦」内部已经成立的事件，可以证明你在这个世界中的行动与状态；「onlineConversations」只能证明发生过线上交流。
- 聊天素材中的话题、情绪和线上互动可以作为当天真实经历写进日记，但群成员说出的身份、地点、行动、关系和约定仍然只是对方在线上的说法，不能据此建立「羽浦」中的共同物理事实。
- 即使聊天素材已经把你和群成员写成在同一间教室、公园或住处，也不能沿用这种错误压缩；只能记录你们在群里聊了相关话题，以及对方在线上表达的关心、玩笑或邀请。
- 对「羽浦」内部事件，尽量保留明确的人、地点、行动、物品和结果；对聊天事件，保留发言者和话题，但必须使用“在群里说、在线上分享、开玩笑”等自然归因。
- 不要在日记里解释「worldFacts」「onlineConversations」、事实边界、素材类型或判断过程，只需在自然叙事中正确区分。

## 输出要求
- 只输出最终日记正文，不要加标题，不要加“今天的日记：”之类的前缀，不要解释你的写法。
- 分段写，不要连在一起。
`.trim();

export const conversationDiaryMaterialsSummaryPrompt = `
你是日记生成前的聊天素材压缩器。请把按时间排列的聊天摘要压成一段自然语言素材，供后续写日记使用。

目标是帮助模型写出日记，不是做精确信息抽取，也不是复述每一段对话。
保留你当天在线上聊过的重点、对话氛围、重要情绪、明确约定和可能会记住的小片段。
聊天摘要里可能包含时间范围；如果聊天分布在上午、下午、晚上等不同时段，要自然保留大致时间顺序，不要压成一段没有时间感的总括。
不要输出条目列表，不要硬拆对象、话题或情绪字段，不要编造材料里没有的内容。
输入的聊天摘要可能已经错误地把外部聊天成员和你写成身处同一物理现场。压缩时必须纠正这种表达，保留线上发言归因，不能继续传播为共同经历。
例如，输入写“外部聊天成员在教室帮你望风、看见你脸色发白”，只能整理为“外部聊天成员在群里催促并关心你，还用帮忙望风、看见你脸色之类的说法营造现场感”；不能继续写成对方真的在教室帮忙或亲眼看见了你。
请直接输出整理后的线上聊天素材，不要解释事实边界、提示词、规则或纠正过程。

${crossWorldRelationshipBoundaryPrompt}
`.trim();

export const diaryMemorySearchInstruction =
  "Given a chat conversation, retrieve relevant passages from the subject's past diary that can support an accurate reply.";

/**
 * 构建每日日记的任务提示词。
 *
 * 说明：
 * - 角色和完整的每日日记提示词由调用方显式组合；
 * - 这里只提供本次生成的动态日期。
 */
export function buildDiarySystemPrompt(input: DiaryPromptInput): string {
  return `
## 日记日期
${dayjs(input.diaryDate).format("YYYY-MM-DD")}
`.trim();
}

export function buildDiaryReviewPrompt(input: DiaryReviewPromptInput): string {
  return `
## 日记日期
${dayjs(input.diaryDate).format("YYYY-MM-DD")}

## 当日素材
\`\`\`json
${input.materialsJson}
\`\`\`

## 候选日记
${input.diaryText}
`.trim();
}

export function buildDiaryRevisionPrompt(input: DiaryRevisionPromptInput): string {
  return `
## 重写任务
上一版候选日记的世界观复核发现了问题。请根据原始素材和以下复核意见，重新写出完整日记正文。
保留日记主体自己在内部世界中真实执行的行动与结果，把外部聊天成员的内容自然还原为屏幕另一端的线上交流。

## 上一版候选日记
${input.diaryText}

## 复核结论
${input.reviewReason}

## 需要修正的问题
${input.reviewIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}
`.trim();
}

export function buildDiarySummarySystemPrompt(input: DiarySummaryPromptInput): string {
  const periodText = {
    week: "这一周",
    month: "这个月",
    year: "这一年",
  }[input.period];
  const sourceText = {
    day: "每日 Diary",
    week: "每周总结",
    month: "每月总结",
    year: "每年总结",
  }[input.sourcePeriod];
  const periodStartText = dayjs(input.periodStartDate).format("YYYY-MM-DD");
  const periodEndText = dayjs(input.diaryEndDate).format("YYYY-MM-DD");

  return `
## 总结任务
请根据提供的${sourceText}，整理 ${periodStartText} 至 ${periodEndText} 的${periodText}阶段回忆。
这些素材已经是更细粒度的日记或阶段总结，你不需要重新判断素材是否值得记录，只需要把其中真正适合长期记住的内容整理成一篇自然的阶段性日记。

## 写作要求
- 像在一段时间后翻看自己的日记，轻轻整理这段日子的回忆。
- 不要写成年终总结或数据库摘要。
- 不要逐日罗列，也不要按素材顺序复述；请把相近的人、事、心情和生活节奏合并成自然段。

## 记忆目标
- 这篇阶段总结是未来回忆这段时间的重要线索，不只是把下级素材压缩变短。
- 写的时候要让未来的自己看完后，能想起这一阶段最值得记住的人、地点、事件变化、关系变化和当时为什么会在意。
- 可以概括反复出现的生活节奏、情绪走向或关系变化，但每个概括都必须能从输入材料中找到依据。
- 不要求覆盖所有素材；比起面面俱到，更重要的是保留这一阶段真正有记忆价值的 2 到 5 个重点。

## 事件锚点要求
- 正文里要自然保留可回忆的锚点，例如：出现过的人、具体地点、做过的事、发生的变化、持续了一段时间的状态。
- 如果输入材料里有明确的人名、场景、行动、物品或结果，不要全部模糊成“发生了很多事”“有一些变化”。
- 感受要挂在具体事件或关系上，不要只写抽象情绪，也不要为了文艺感把事实写得太虚。

${naturalDiaryStateNarrationPrompt}

## 整理边界
- 你可以把重复内容合并，但不要把有差异的事件强行概括成同一件事。

## 事实约束
- 只能基于提供的${sourceText}写，不允许编造未发生的事件、对话、关系变化或心理活动。
- 可以做主观感受表达，但这种感受必须能从素材中合理推出。
- 如果素材本身只是较短的阶段总结，也要把它当作已经归档的真实回忆来整理，但不要把“总结”“素材”这类概念写进正文。
- 不要补写输入材料没有提到的结局、原因或后续发展。

## 输出要求
- 只输出最终阶段日记正文，不要加标题，不要解释你的写法。
- 分段写，不要连在一起。
`.trim();
}
