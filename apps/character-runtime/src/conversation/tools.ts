import { getMultimodalModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, tool, type UserContent } from "ai";
import { z } from "zod";
import { recallExperiences, recallSchema } from "../memory/experiences";
import { formatPeople, readPeople } from "../memory/people";
import { formatPlans, readPlans } from "../plan/plan";
import {
  type ConversationMessage,
  type ConversationScope,
  type IncomingEvent,
  type ReplyTarget,
  renderMessage,
} from "./message";
import type { OneBotConnection } from "./onebot";
import type { Replyer } from "./replyer";
import { sendReply } from "./sender";

/** Planner 从聊天 XHTML 中选择需要理解的媒体，不要求一次读取全部附件。 */
const understandMediaSchema = z.object({
  media: z
    .array(
      z.object({
        type: z.enum(["image", "audio", "video"]).describe("你要理解的媒体类型。"),
        url: z
          .url({ protocol: /^https?$/ })
          .describe("你从媒体标签 src 中读取的完整 HTTP(S) 地址。"),
      }),
    )
    .min(1)
    .describe("你本次需要理解的媒体，结果按此顺序对应。"),
  instruction: z
    .string()
    .min(1)
    .optional()
    .describe("你希望重点理解的问题；不填则概述主要内容和可辨认的话语。"),
});

const replySchema = z.object({
  replyContext: z
    .string()
    .min(1)
    .describe("你本次想表达什么，以及必要事实与交流背景；不写成品台词。"),
  quoteMessageId: z.string().min(1).optional().describe("你要引用的消息 id；不引用则不填。"),
  "sender-id": z.string().min(1).optional().describe("你要 @ 的人的 sender-id；不 @ 则不填。"),
});
const pokeSchema = z.object({
  "sender-id": z.string().min(1).describe("你想戳的人的 sender-id。"),
});
const waitSchema = z.object({
  seconds: z.number().int().min(1).max(60).describe("你想等待多少秒后再判断。"),
});
const noticeSchema = z.strictObject({
  description: z.string().min(1).describe("你认为值得角色关注的交流或安排请求，不替角色接受承诺"),
  messageIds: z.array(z.string().min(1)).min(1).describe("提供直接依据的真实消息 id"),
});
const personSchema = z.strictObject({ "sender-id": z.string().min(1) });

/** 不绑定执行逻辑的工具定义，规划和压缩共用同一套 schema。 */
export const plannerTools = {
  notifyCharacter: tool({
    description: "你可以将重要交流告知角色大脑，不为普通消息重复触发。",
    inputSchema: noticeSchema,
  }),
  recall: tool({
    description: "你可以回忆仍能想起的世界亲历及本群交流，按当前状态理解。",
    inputSchema: recallSchema,
  }),
  readPerson: tool({
    description: "你可以读取对这个人的已有认识，仅呈现本群可以使用的内容。",
    inputSchema: personSchema,
  }),
  readPlans: tool({
    description: "你可以查看角色已经接受的安排与进展。",
    inputSchema: z.strictObject({}),
  }),
  understandMedia: tool({
    description: "你按需查看图片、聆听音频或观看视频，获得文字理解结果后继续判断。",
    inputSchema: understandMediaSchema,
  }),
  reply: tool({
    description: "你提供交流意图，生成并发送回复，返回实际发送的消息。",
    inputSchema: replySchema,
  }),
  poke: tool({ description: "你戳一戳某个人，返回实际执行结果。", inputSchema: pokeSchema }),
  wait: tool({
    description: "你在当前步骤的工具全部完成后暂停，等待指定秒数再继续判断。",
    inputSchema: waitSchema,
  }),
};
/** 用于估算工具定义占用的上下文大小。 */
export const plannerToolDescription = JSON.stringify(
  Object.fromEntries(
    Object.entries({
      understandMedia: understandMediaSchema,
      reply: replySchema,
      poke: pokeSchema,
      wait: waitSchema,
      notifyCharacter: noticeSchema,
      recall: recallSchema,
      readPerson: personSchema,
      readPlans: z.strictObject({}),
    }).map(([name, schema]) => [
      name,
      {
        description: plannerTools[name as keyof typeof plannerTools].description,
        inputSchema: z.toJSONSchema(schema),
      },
    ]),
  ),
);
/** 工具入口将 sender-id 转为发送接口使用的 senderId，不再包装为待执行的行动。 */
export type ReplyInput = ReplyTarget & { replyContext: string };

/** 一轮工具执行使用的会话依赖与进度；由 loop 持有，模型调用失败后仍可判断是否已发送。 */
export type ConversationToolContext = {
  canParticipate: () => boolean;
  readCharacter: () => Promise<string>;
  notifyCharacter: (description: string, messageIds: string[]) => Promise<string>;
  connection: OneBotConnection;
  replyer: Replyer;
  /** 固定本轮收到的消息，执行期间仅追加已确认发送的事件。 */
  history: ConversationMessage[];
  /** 开始本轮时的历史边界；之后自己的发送先作为 Replyer 临时上下文，避免摘要跳过排队的新消息。 */
  historyThrough: number;
  /** 将平台确认的事件写入真实历史和本轮快照，再持久化。 */
  recordSent: (events: IncomingEvent[]) => Promise<void>;
  /** 每段回复或戳一戳发出前，等待会话保存发送标记。 */
  beforeSend: () => Promise<void>;
  /** Replyer 应用新摘要后，由会话保存摘要和原文裁剪。 */
  saveReplyerSummary: () => Promise<void>;
  /** 进入平台发送前设置；即使结果未确认，也不能重跑整个输入批次。 */
  sendAttempted: boolean;
  /** 本轮是否出现工具失败；失败不能计为主动沉默。 */
  failed: boolean;
  /** wait 成功时设置，Planner 停止后由 loop 安排唤醒。 */
  waitSeconds?: number;
};

/** 工具直接执行，返回值由 SDK 转为 tool message；不另行追加执行反馈。 */
export function createPlannerTools(
  scope: ConversationScope,
  timezone: string,
  context: ConversationToolContext,
) {
  let replyQueue = Promise.resolve();

  return {
    notifyCharacter: tool({
      ...plannerTools.notifyCharacter,
      async execute({ description, messageIds }) {
        try {
          if (!context.canParticipate()) {
            return "角色已经暂停群聊，不唤醒角色处理这段交流。";
          }
          if (
            messageIds.some(
              (id) =>
                !context.history.some((message) => message.kind === "message" && message.id === id),
            )
          ) {
            return "来源消息不在当前真实交流中，请使用可见消息的 id。";
          }
          return await context.notifyCharacter(description, messageIds);
        } catch (error) {
          logger.error("告知角色失败", { ...scope, error });
          return `告知角色失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    recall: tool({
      ...plannerTools.recall,
      async execute(input) {
        try {
          return await recallExperiences(scope.characterId, input, scope);
        } catch (error) {
          logger.error("聊天回忆失败", { ...scope, error });
          return `回忆暂未成功：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    readPerson: tool({
      ...plannerTools.readPerson,
      async execute({ "sender-id": userId }) {
        try {
          return await formatPeople(
            await readPeople(scope.characterId, { platform: scope.platform, userId }, scope),
          );
        } catch (error) {
          logger.error("人物认识读取失败", { ...scope, error });
          return `人物认识读取失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    readPlans: tool({
      ...plannerTools.readPlans,
      async execute() {
        try {
          return await formatPlans(await readPlans(scope.characterId));
        } catch (error) {
          logger.error("角色计划读取失败", { ...scope, error });
          return `角色计划读取失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    understandMedia: tool({
      ...plannerTools.understandMedia,
      execute: async (input, { abortSignal }) => await understandMedia(input, scope, abortSignal),
    }),
    reply: tool({
      ...plannerTools.reply,
      execute: async ({ "sender-id": senderId, ...input }) => {
        // 只排队回复，覆盖生成、分段发送与记录；其他工具不等待此队列。
        const previousReply = replyQueue;
        let release!: () => void;
        replyQueue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previousReply;

        const sent: IncomingEvent[] = [];
        let stage = "replyer";
        let failure: string | undefined;
        try {
          const replyInput = { ...input, senderId };
          const text = await context.replyer.reply(
            replyInput,
            [...context.history],
            context.historyThrough,
            context.saveReplyerSummary,
            await context.readCharacter(),
          );
          for await (const events of sendReply(
            context.connection,
            scope.channelId,
            text,
            replyInput,
            async () => {
              stage = "prepare-send";
              await context.beforeSend();
              context.sendAttempted = true;
              stage = "send";
            },
          )) {
            // 先保存本次工具确认的结果，落库失败也不能抹去发送事实。
            sent.push(...events);
            stage = "storage";
            await context.recordSent(events);
            stage = "send";
          }
        } catch (error) {
          context.failed = true;
          logger.error("回复工具执行失败", { ...scope, stage, error });
          switch (stage) {
            case "replyer":
              failure = `回复生成失败，未发送：${error instanceof Error ? error.message : String(error)}`;
              break;
            case "prepare-send":
              failure = "本段发送前状态保存失败，后续发送已停止。";
              break;
            case "send":
              failure = "发送中断，以下记录之外的发送结果未确认。";
              break;
            case "storage":
              failure = "以下消息已确认发送，记录保存失败，后续发送已停止。";
              break;
          }
        } finally {
          release();
        }
        const result = sent.map((message) => renderMessage(message, timezone));
        if (failure) result.unshift(failure);
        return result.join("\n");
      },
    }),
    poke: tool({
      ...plannerTools.poke,
      execute: async ({ "sender-id": senderId }) => {
        const sent: IncomingEvent[] = [];
        let stage: "prepare-send" | "send" | "storage" = "prepare-send";
        let failure: string | undefined;
        try {
          await context.beforeSend();
          stage = "send";
          context.sendAttempted = true;
          const event = await context.connection.poke(scope.channelId, senderId);
          sent.push(event);
          stage = "storage";
          await context.recordSent([event]);
        } catch (error) {
          context.failed = true;
          logger.error("戳一戳工具执行失败", { ...scope, stage, error });
          failure =
            stage === "prepare-send"
              ? "发送前状态保存失败，未执行戳一戳。"
              : stage === "send"
                ? "戳一戳执行失败，结果未确认。"
                : "以下戳一戳已确认执行，记录保存失败。";
        }
        const result = sent.map((message) => renderMessage(message, timezone));
        if (failure) result.unshift(failure);
        return result.join("\n");
      },
    }),
    wait: tool({
      ...plannerTools.wait,
      execute: async ({ seconds }) => {
        // stopWhen 在本步所有工具完成后检查此状态，不取消并发或排队中的回复。
        context.waitSeconds = seconds;
        return `本步工具完成后暂停，等待 ${seconds} 秒后继续。`;
      },
    }),
  };
}

/** 下载并理解所选媒体；失败返回阶段与原因，由 Planner 决定后续处理，不中断工具循环。 */
async function understandMedia(
  { media, instruction }: z.infer<typeof understandMediaSchema>,
  scope: ConversationScope,
  abortSignal?: AbortSignal,
) {
  const startedAt = Date.now();
  let stage = "准备提示词";
  try {
    const instructions = await renderPrompt("conversation.multimodal");
    const content: UserContent = [];
    if (instruction !== undefined) {
      content.push({ type: "text", text: instruction });
    }

    for (const [index, item] of media.entries()) {
      stage = `下载第 ${index + 1} 个媒体（${item.type}）`;
      const response = await fetch(item.url, { signal: abortSignal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      content.push(
        { type: "text", text: `媒体 ${index + 1}（${item.type}）` },
        {
          type: "file",
          data: new Uint8Array(await response.arrayBuffer()),
          // SDK 根据文件字节识别具体 MIME；不凭 URL 后缀猜测格式，也不转码。
          mediaType: item.type,
        },
      );
    }

    stage = "调用多模态模型";
    const result = await generateText({
      model: getMultimodalModel([...new Set(media.map((item) => item.type))]),
      instructions,
      messages: [{ role: "user", content }],
      maxRetries: 0,
      abortSignal,
    });
    if (result.finishReason !== "stop" || !result.text.trim()) {
      throw new Error(`未正常生成理解结果：${result.finishReason}`);
    }
    logger.info("聊天媒体理解完成", {
      ...scope,
      stage: "planner.multimodal",
      mediaCount: media.length,
      durationMs: Date.now() - startedAt,
      usage: result.usage,
    });
    return result.text.trim();
  } catch (error) {
    logger.error("聊天媒体理解失败", {
      ...scope,
      stage: "planner.multimodal",
      failedAt: stage,
      mediaCount: media.length,
      durationMs: Date.now() - startedAt,
      error,
    });
    // 返回明确的失败事实，完整异常留在日志；不标记整轮失败或由程序重跑批次。
    return `媒体理解失败：${stage}失败，${error instanceof Error ? error.message : String(error)}`;
  }
}
