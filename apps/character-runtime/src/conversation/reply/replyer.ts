import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { h } from "@satorijs/core";
import { reportAnalyticsEvent } from "@yuiju/shared/analytics/report-event";
import { load_config } from "@yuiju/shared/config/load";
import { estimateInputTokens, readInputTokenUsage } from "@yuiju/shared/llm/context-usage";
import { chatModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { BusinessMonitor } from "@yuiju/shared/monitoring/monitor";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import {
  APICallError,
  type Experimental_DecisionResult,
  experimental_decide,
  generateText,
  type ModelMessage,
} from "ai";
import { type ContextSummary, ConversationContext } from "../context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "../message";
import type { ReplyInput } from "../planner/tools";
import { parseStickerReply } from "../sticker/reply";
import { collectReplyerGeneration, type ReplyerSystemPrompt } from "./training-data";

const QUALITY_REJECTION_THRESHOLD = 0.7;

/** 每群独立的回复上下文；长期历史只保留真实交流，本轮补充上下文作为末尾临时输入。 */
export class Replyer {
  private context!: ConversationContext;
  /** 请求与采集共用渲染结果，避免采集时重新读取已变化的提示词。 */
  private systemPrompts!: ReplyerSystemPrompt[];
  /** 初始化时从合并默认值后的项目配置读取，与消息发生时间使用同一展示时区。 */
  private timezone!: string;
  private qualityModel?: ReturnType<ReturnType<typeof createTypeSafeAi>["decisionModel"]>;
  /** 与质检模型同时初始化，供每次请求埋点标记接口域名，不保存整份供应商配置。 */
  private qualityHost?: string;
  private qualityMonitor?: BusinessMonitor;

  constructor(
    private readonly scope: ConversationScope,
    private readonly collectTrainingData: boolean,
    private readonly botIds: readonly string[],
    private readonly checkReplyQuality: boolean,
  ) {}

  async initialize(summary: Readonly<ContextSummary>) {
    const config = await load_config();
    this.timezone = config.app!.timezone!;
    if (this.checkReplyQuality) {
      const decision = config.llm?.models?.decision;
      if (!decision) {
        throw new Error("启用回复质量检查需要配置 llm.models.decision");
      }
      this.qualityModel = createTypeSafeAi({
        baseURL: decision.base_url,
        apiKey: decision.api_key,
      }).decisionModel(decision.model);
      this.qualityHost = new URL(decision.base_url).host;
      this.qualityMonitor = new BusinessMonitor({
        monitorKey: "replyer.quality_check",
        app: "character-runtime",
        characterId: this.scope.characterId,
        channelId: this.scope.channelId,
        severity: "warning",
        title: "回复质量检查不可用",
        impact: "回复将跳过质量检查",
        failureThreshold: 1,
        cooldownMs: 5 * 60_000,
      });
    }
    const windowTokens = config.llm?.models?.chat?.context_window_tokens;
    if (!windowTokens) {
      throw new Error("群聊需要配置 chat.context_window_tokens");
    }
    const [systemPrompts, compressionPrompt] = await Promise.all([
      Promise.all(
        [
          `character.persona.${this.scope.characterId}`,
          "conversation.replyer",
          `conversation.replyer.${this.scope.characterId}`,
        ].map(async (key) => ({ key, content: await renderPrompt(key) })),
      ),
      renderPrompt("conversation.replyer_compression"),
    ]);
    this.systemPrompts = systemPrompts;
    this.context = new ConversationContext(
      {
        stage: "replyer",
        scope: this.scope,
        system: this.systemPrompts.map((prompt) => prompt.content).join("\n\n"),
        compressionPrompt,
        model: chatModel,
        windowTokens,
      },
      summary,
    );
  }

  get summary() {
    return this.context.summary;
  }

  async replacePausedSummary(summary: ContextSummary): Promise<void> {
    await this.context.stop();
    this.context.replaceSummary(summary);
  }

  observe(history: ConversationMessage[]) {
    // loop 在没有执行中的轮次或一轮结束后调用，旁听也能推进压缩。
    this.context.applyCompression();
    this.context.maintain(this.historyUnits(history), [], undefined);
  }

  private historyUnits(history: ConversationMessage[]) {
    return history
      .filter((message) => message.sequence > this.context.summary.coveredThrough)
      .map((message) => ({
        sequence: message.sequence,
        messages: [
          {
            role: "user",
            content: renderMessage(message, this.timezone, this.botIds),
          } satisfies ModelMessage,
        ],
      }));
  }

  /**
   * historyThrough 之后的发送仅供本次生成参考，轮次结束后再和排队的新消息一起压缩。
   * 误认交流对象三次未改正则不发送；其他质检项保留本轮收到 @ 或引用后的第三版放行规则。
   */
  async reply(
    input: ReplyInput,
    history: ConversationMessage[],
    historyThrough: number,
    saveSummary: () => Promise<void>,
    characterContext: string,
    availableStickerTags: readonly string[],
    receivedMentionOrReply: boolean,
  ): Promise<
    { status: "reply"; text: string } | { status: "no_reply" } | { status: "quality_rejected" }
  > {
    const startedAt = performance.now();
    try {
      const previousSummary = this.context.summary;

      // 引用只使用当前可见的事实；不为一次回复同步读取 MongoDB。
      const quote = history.find(
        (message) => message.kind === "message" && message.id === input.quoteMessageId,
      );
      const embeddedQuote = history
        .flatMap((message) => (message.kind === "message" && message.quote ? [message.quote] : []))
        .find((item) => item.id === input.quoteMessageId && item.content !== undefined);
      if (input.quoteMessageId && !quote && !embeddedQuote) {
        throw new Error(`当前上下文没有引用原文：${input.quoteMessageId}`);
      }

      const mentioned = input.senderId
        ? history.find((message) => message.senderId === input.senderId)
        : undefined;

      // 当前任务始终放在历史之后，避免每次不同的补充上下文破坏稳定前缀。
      const taskLines = [`当前角色状态：\n${characterContext}`];
      if (input.replyContext !== undefined) {
        taskLines.push(`补充上下文：\n${input.replyContext}`);
      }
      if (quote) {
        taskLines.push(`本次引用：${renderMessage(quote, this.timezone, this.botIds)}`);
      }
      if (!quote && embeddedQuote) {
        taskLines.push(
          `本次引用：${h(
            "quote",
            {
              id: embeddedQuote.id,
              senderId: embeddedQuote.senderId,
              senderName: embeddedQuote.senderName,
              ...(embeddedQuote.senderId !== undefined &&
                this.botIds.includes(embeddedQuote.senderId) && { isBot: "true" }),
            },
            h.parse(embeddedQuote.content!),
          ).toString()}`,
        );
      }
      if (input.senderId) {
        taskLines.push(
          `本次发送时，程序会在正文前附加对发送者 ${input.senderId}${mentioned?.senderName ? `（${mentioned.senderName}）` : ""} 的 @。你只写正文，无需重复 @ 或生成消息协议标签。`,
        );
      }
      const stickerTags = [...new Set(availableStickerTags)];
      taskLines.push(
        stickerTags.length
          ? `本次可用表情标签：${stickerTags.map((tag) => `[${tag}]`).join("、")}`
          : "本次没有可用表情标签，只输出聊天文字或 [[NO_REPLY]]。",
      );
      const task: ModelMessage = { role: "user", content: taskLines.join("\n") };
      // 自己的新发送可能排在尚未处理的群消息之后，不能提前推进摘要覆盖序号。
      const messages = await this.context.prepare(
        this.historyUnits(history.filter((message) => message.sequence <= historyThrough)),
        [
          ...history
            .filter((message) => message.sequence > historyThrough)
            .map(
              (message): ModelMessage => ({
                role: "user",
                content: renderMessage(message, this.timezone, this.botIds),
              }),
            ),
          task,
        ],
        undefined,
      );

      if (previousSummary !== this.context.summary) {
        await saveSummary();
      }

      const questions = this.qualityModel
        ? {
            misdirectedReply: {
              type: "boolean" as const,
              instructions:
                '待检查回复由聊天记录中 is-self="true" 的角色发送。判断回复是否接错了对话对象：其他群友正在彼此问答，角色却把发给别人的提问或回应，当成发给自己的，直接以被提问者或被回应者的身份接话。根据发送者、引用和 @ 确定对话双方，区分替其中一人作答与补充自己的看法。主动搭话、接梗和分享独立经历不算接错，不能仅凭没有 @ 当前角色就判定为误认。',
            },
            unwantedAdvice: {
              type: "boolean" as const,
              instructions:
                "结合聊天上下文和待检查的回复，判断回复是否把对方的闲聊、吐槽或玩笑当作求助，在对方没有请求建议的情况下，给出不合时宜的指导、解决步骤或说教。对方确实寻求建议或帮助时，回应请求不算命中；顺着聊天表达自己的看法、简短关心或角色自然的反应也不算命中。",
            },
            genericEmpathy: {
              type: "boolean" as const,
              instructions:
                "结合聊天上下文和待检查的回复，判断回复是否用脱离具体处境的套话式共情、鼓励或强行正能量代替回应，例如把普通吐槽变成情绪疏导，或用几乎适用于任何人的励志话收尾。自然的关心、回应具体处境的安慰，以及对方明确希望得到安慰时真诚的鼓励都不算命中。",
            },
            overexplaining: {
              type: "boolean" as const,
              instructions:
                "结合聊天上下文和待检查的回复，判断回复是否不参与当下交流，而是分析或解释对方玩笑的笑点，或者把对方刚说过的内容逐项复述、总结后再作回应。自然地引用少量内容、确认有歧义的信息、接梗或回应对方提到的具体细节都不算命中。",
            },
          }
        : undefined;
      const retries: ModelMessage[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const generationMessages = [...messages, ...retries];
        const requestEstimate = estimateInputTokens(generationMessages);
        const result = await generateText({
          model: chatModel,
          messages: generationMessages,
          allowSystemInMessages: true,
          maxRetries: 0,
        });
        this.context.inputUsage = readInputTokenUsage(requestEstimate, result.finalStep.usage);
        const text = result.text.trim();
        if (result.finishReason !== "stop") {
          throw new Error(`Replyer 未正常生成文字：${result.finishReason}`);
        }
        if (this.collectTrainingData) {
          // 原始生成包含尚未发送的草稿；采集记录使用本次实际输入。
          collectReplyerGeneration(
            this.scope,
            this.systemPrompts,
            generationMessages.slice(1),
            text,
            result.finalStep.response.modelId,
            result.finalStep.reasoningText,
          );
        }
        const parsed = parseStickerReply(text, availableStickerTags);
        const replyContent =
          parsed.tag === undefined ? parsed.text : `${parsed.text}[${parsed.tag}]`;
        if (!parsed.text && parsed.tag === undefined) {
          logger.info("Replyer 本次没有可发送内容", {
            durationMs: Math.round(performance.now() - startedAt),
          });
          return { status: "no_reply" };
        }
        // 消息协议只用于输入和平台发送；模型生成的协议标签不能成为待发送正文。
        if (
          /<\/?(?:at|message|quote|poke|img|image|audio|video|file)(?=[\s/>])[^>]*>/i.test(
            parsed.text,
          )
        ) {
          throw new Error(
            "Replyer 输出包含消息协议标签，未发送；正文只能是普通文字，@ 和引用由程序附加",
          );
        }
        if (this.qualityModel && questions) {
          const qualityStartedAt = performance.now();
          let evaluation: Experimental_DecisionResult<typeof questions> | undefined;
          let qualityError: unknown;
          try {
            evaluation = await experimental_decide({
              model: this.qualityModel,
              // Replyer 组装的是文本消息，保留角色和正文顺序，不再嵌套 JSON 字符串。
              state: [
                ...generationMessages.map((message) => `${message.role}:\n${message.content}`),
                `待检查的回复：\n${replyContent}`,
              ].join("\n\n"),
              questions,
              maxRetries: 0,
            });
            this.qualityMonitor!.success();
          } catch (error) {
            qualityError = error;
            this.qualityMonitor!.failure({
              message: error instanceof Error ? error.message : String(error),
            });
            // 质检服务不可用时继续使用当前回复，不重跑生成，也不伪造通过结果。
            logger.warn("Jev 调用失败，本次跳过回复质量检查", {
              model: this.qualityModel.modelId,
              attempt,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            // 一次 Jev 请求计一次；质检拒绝是成功返回，调用异常才计为失败。
            reportAnalyticsEvent({
              eventName: "llm.request",
              eventData: {
                group: "decision",
                host: this.qualityHost!,
                provider: this.qualityModel.provider,
                model: this.qualityModel.modelId,
                durationMs: Math.round(performance.now() - qualityStartedAt),
                status: evaluation === undefined ? "failed" : "success",
                errorName: qualityError instanceof Error ? qualityError.name : undefined,
                statusCode: APICallError.isInstance(qualityError)
                  ? qualityError.statusCode
                  : undefined,
                inputTokens: evaluation?.usage.inputTokens ?? null,
                outputTokens: evaluation?.usage.outputTokens ?? null,
                cacheReadTokens: null,
                reasoningTokens: null,
              },
            });
          }
          if (evaluation !== undefined) {
            const probabilities = {
              misdirectedReply: evaluation.answers.misdirectedReply.probability,
              unwantedAdvice: evaluation.answers.unwantedAdvice.probability,
              genericEmpathy: evaluation.answers.genericEmpathy.probability,
              overexplaining: evaluation.answers.overexplaining.probability,
            };
            const issues = [
              ...(probabilities.misdirectedReply >= QUALITY_REJECTION_THRESHOLD
                ? ["误把群友之间的交流当成在与自己对话。"]
                : []),
              ...(probabilities.unwantedAdvice >= QUALITY_REJECTION_THRESHOLD
                ? ["对方未请求建议，却给出不合时宜的建议或说教。"]
                : []),
              ...(probabilities.genericEmpathy >= QUALITY_REJECTION_THRESHOLD
                ? ["使用脱离具体处境的套话式共情或鼓励。"]
                : []),
              ...(probabilities.overexplaining >= QUALITY_REJECTION_THRESHOLD
                ? ["解释玩笑或过度复述对方刚说的内容。"]
                : []),
            ];
            logger.info("Replyer 回复质量检查", {
              model: evaluation.response.modelId,
              attempt,
              probabilities,
              passed: issues.length === 0,
              usage: evaluation.usage,
            });
            if (issues.length) {
              if (attempt < 3) {
                retries.push({
                  role: "user",
                  content: `上一版回复未通过：\n${text}\n\n问题：\n${issues.join("\n")}`,
                });
                continue;
              }
              if (
                probabilities.misdirectedReply >= QUALITY_REJECTION_THRESHOLD ||
                !receivedMentionOrReply
              ) {
                return { status: "quality_rejected" };
              }
              logger.info("本轮收到 @ 或引用回复，质量检查三次未通过，放行第三版回复", {
                attempt,
                probabilities,
              });
            }
          }
        }
        logger.info("Replyer 生成完成", {
          content: text,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return {
          status: "reply",
          text: replyContent,
        };
      }
      throw new Error("Replyer 回复质量检查未正常结束");
    } finally {
      reportAnalyticsEvent({
        eventName: "conversation.replyer",
        eventData: {
          ...this.scope,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    }
  }

  async stop() {
    await this.context.stop();
  }
}
