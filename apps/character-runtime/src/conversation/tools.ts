import { getMultimodalModel } from "@yuiju/shared/llm/models";
import { truncateToolOutput } from "@yuiju/shared/llm/tool-output";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, tool, type UserContent } from "ai";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { formatPeople, readPeople, updatePersonMemory } from "../memory/people";
import { recallExperiences, recallSchema } from "../memory/recall";
import { formatPlans } from "../plan/plan";
import { readPlans } from "../plan/storage";
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

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

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
    .optional()
    .describe(
      "你补充 Replyer 看不到的相关信息，例如查询结果、媒体理解或主 loop 事件，保留来源、时间、已确定的决定与不确定性。交错话题需要定位时，可指出本次接哪件事。Replyer 已有群聊、人设和当前角色状态；没有额外上下文时不填。不提供回复提纲、口吻指令、心理解读或成品台词。",
    ),
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
  description: z
    .string()
    .min(1)
    .describe(
      "你要传递的事情及相关事实，包括涉及的人、尚未确定的内容和你已经表达的态度；区分对方的说法与你自己的决定。",
    ),
  messageIds: z
    .array(z.string().min(1))
    .describe("你提供直接依据的真实消息 id；反馈主 loop 事件且没有相关群消息时可为空"),
  relatedEventId: z
    .string()
    .min(1)
    .optional()
    .describe("你反馈的主 loop 事件 ID；独立的群聊信息不填，不是消息 id"),
});
const personSchema = z.strictObject({ "sender-id": z.string().min(1) });
const personMemorySchema = personSchema.extend({
  description: z
    .string()
    .min(1)
    .describe("你认为值得记住的新信息、纠正或重要互动，保留不确定性，不代写完整画像。"),
  messageIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("支持本次更新的真实消息 id；提供必要的前后文、纠正和回应，不只摘取一句话。"),
});

/** 不绑定执行逻辑的工具定义，规划和压缩共用同一套 schema。 */
export const plannerTools = {
  notifyCharacter: tool({
    description:
      "你将群聊中值得带回生活里考虑的事情传递给主 loop，供后续生活决策使用。也可以通过 relatedEventId 反馈主 loop 事件的实际交流结果。通知只投递事件，不等待决定、不发送群消息，也不表示接受邀请或建立计划。",
    inputSchema: noticeSchema,
  }),
  recall: tool({
    description:
      "你可以回忆已经整理的生活经历；这里不查询人物画像，了解某个人请使用 readPerson。每日记忆在零点整理前一天，今天未整理的内容不在其中；久远记忆可能只剩周、月、年概括。search 按语义搜索相关片段，read 按日期返回记忆正文；日期为 YYYY-MM-DD，两种查询均遵守遗忘范围。长结果会省略中间内容，可缩小日期范围或按具体问题搜索。搜索未命中只代表没有找到相关经历，不能据此判断你不认识某个人。",
    inputSchema: recallSchema,
  }),
  readPerson: tool({
    description:
      "你可以按消息中的 sender-id 读取对这个人的已有认识，包括称呼、已知事实、过去互动及关系感受。需要判断是否认识对方、记得对方什么时使用，不按昵称搜索。同一平台身份跨群共用画像，并联合读取手动关联的其他平台身份；没有画像也不代表从未认识。",
    inputSchema: personSchema,
  }),
  updatePersonMemory: tool({
    description:
      "你可以提交值得记住的人物信息，程序会结合来源原文和旧画像生成、审查并保存。仅发过言、普通接话不需要记录；不把玩笑或猜测写成事实。返回实际更新结果，失败或审查未通过时不要重复提交同一内容。",
    inputSchema: personMemorySchema,
  }),
  readPlans: tool({
    description: "你可以查看角色已经接受的安排与进展。",
    inputSchema: z.strictObject({}),
  }),
  understandMedia: tool({
    description:
      "你可以查看图片、聆听音频或观看视频。传入媒体类型和标签 src 中的完整地址，可附上关注的问题；返回的文字理解或读取失败信息，供后续判断和回复使用。长结果会省略中间内容，可减少本次媒体数量或提出更具体的问题。",
    inputSchema: understandMediaSchema,
  }),
  reply: tool({
    description:
      "你决定这次要参与文字交流后调用，不能用它试探是否还能接一句。Replyer 根据聊天记录、人设与补充上下文决定具体回复，也可以选择本次不回复；返回实际发送记录或未发送的结果。主动不回复不是执行失败。没有额外上下文时省略 replyContext；引用和 @ 可选，分别使用消息 id 和 sender-id。",
    inputSchema: replySchema,
  }),
  poke: tool({ description: "你戳一戳某个人，返回实际执行结果。", inputSchema: pokeSchema }),
  wait: tool({
    description:
      "你安排一次主动定时唤醒：本步工具完成后暂停，到期即使无人发消息也会再判断。用于对方明确还没说完等具体短暂停顿。它不是结束工具，也不是等待下一条群消息；旁听、聊完、等别人回话时不调用工具即可结束。",
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
      updatePersonMemory: personMemorySchema,
      readPlans: z.strictObject({}),
    }).map(([name, schema]) => [
      name,
      {
        description: plannerTools[name as keyof typeof plannerTools].description,
        inputSchema: z.toJSONSchema(schema, { io: "input" }),
      },
    ]),
  ),
);
/** 工具入口将 sender-id 转为发送接口使用的 senderId，不再包装为待执行的行动。 */
export type ReplyInput = ReplyTarget & { replyContext?: string };

/** 一轮工具执行使用的会话依赖与进度；由 loop 持有，模型调用失败后仍可判断是否已发送。 */
export type ConversationToolContext = {
  readCharacter: () => Promise<string>;
  notifyCharacter: (
    description: string,
    messageIds: string[],
    relatedEventId?: string,
  ) => Promise<string>;
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
  botIds: readonly string[],
  context: ConversationToolContext,
) {
  let replyQueue = Promise.resolve();

  return {
    notifyCharacter: tool({
      ...plannerTools.notifyCharacter,
      async execute({ description, messageIds, relatedEventId }) {
        try {
          if (!relatedEventId && !messageIds.length) {
            return "未投递：独立的群聊信息需要提供来源消息 id；反馈主 loop 事件时请提供 relatedEventId。";
          }
          if (
            messageIds.some(
              (id) =>
                !context.history.some((message) => message.kind === "message" && message.id === id),
            )
          ) {
            return "来源消息不在当前真实交流中，请使用可见消息的 id。";
          }
          return await context.notifyCharacter(description, messageIds, relatedEventId);
        } catch (error) {
          logger.error("告知角色失败", { error });
          return `告知角色失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    recall: tool({
      ...plannerTools.recall,
      async execute(input) {
        try {
          return await recallExperiences(scope.characterId, input);
        } catch (error) {
          logger.error("聊天回忆失败", { error });
          return `回忆暂未成功：${error instanceof Error ? error.message : String(error)}`;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
    }),
    readPerson: tool({
      ...plannerTools.readPerson,
      async execute({ "sender-id": userId }) {
        try {
          return formatPeople(
            await readPeople(scope.characterId, { platform: scope.platform, userId }),
          );
        } catch (error) {
          logger.error("人物认识读取失败", { error });
          return `人物认识读取失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
    }),
    updatePersonMemory: tool({
      ...plannerTools.updatePersonMemory,
      async execute({ "sender-id": senderId, description, messageIds }, { abortSignal }) {
        try {
          const messages = context.history.filter(
            (message) => message.kind === "message" && messageIds.includes(message.id),
          );
          if (
            messageIds.some(
              (id) => !messages.some((message) => message.kind === "message" && message.id === id),
            )
          ) {
            return "未更新：来源消息不在当前真实交流中，请使用可见消息的 id。";
          }
          const person = [...context.history]
            .reverse()
            .find(
              (message) =>
                message.kind === "message" && !message.isSelf && message.senderId === senderId,
            );
          if (!person) {
            return "未更新：人物必须是当前真实交流中的群友，不能按昵称猜测 sender-id。";
          }
          const result = await updatePersonMemory(
            scope.characterId,
            {
              platform: scope.platform,
              userId: senderId,
              name: person.senderName,
              lastSpokeAt: person.timestamp,
            },
            {
              description,
              messages: messages.map((message) => ({
                date: dayjs(message.timestamp).tz(timezone).format("YYYY-MM-DD"),
                text: renderMessage(message, timezone, botIds),
              })),
            },
            abortSignal,
          );
          return {
            updated: "人物画像已更新。",
            unchanged: "无需更新，当前画像已经包含这些认识或没有值得新增的内容。不要重复提交。",
            rejected: "审查未通过，保留原画像。不要重复提交同一内容。",
          }[result];
        } catch (error) {
          logger.error("人物画像更新失败", { error });
          return `人物画像更新失败，本次不再重试。不要重复提交同一内容：${error instanceof Error ? error.message : String(error)}`;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
    }),
    readPlans: tool({
      ...plannerTools.readPlans,
      async execute() {
        try {
          return await formatPlans(await readPlans(scope.characterId));
        } catch (error) {
          logger.error("角色计划读取失败", { error });
          return `角色计划读取失败：${error instanceof Error ? error.message : String(error)}`;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
    }),
    understandMedia: tool({
      ...plannerTools.understandMedia,
      execute: async (input, { abortSignal }) => await understandMedia(input, scope, abortSignal),
      toModelOutput: ({ output }) => ({ type: "text", value: truncateToolOutput(output) }),
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
          const generationStartedAt = performance.now();
          const reply = await context.replyer.reply(
            replyInput,
            [...context.history],
            context.historyThrough,
            context.saveReplyerSummary,
            await context.readCharacter(),
          );
          if (reply.status === "no_reply") {
            return "本次未发送：Replyer 判断当前无需回复。";
          }
          if (reply.status === "quality_rejected") {
            return "本次未发送：Replyer 回复质量检查三次未通过。";
          }
          for await (const events of sendReply(
            context.connection,
            scope.channelId,
            reply.text,
            replyInput,
            generationStartedAt,
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
          logger.error("回复工具执行失败", { stage, sentCount: sent.length, error });
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
        const result = sent.map((message) => renderMessage(message, timezone, botIds));
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
          logger.error("戳一戳工具执行失败", { stage, sentCount: sent.length, error });
          failure =
            stage === "prepare-send"
              ? "发送前状态保存失败，未执行戳一戳。"
              : stage === "send"
                ? "戳一戳执行失败，结果未确认。"
                : "以下戳一戳已确认执行，记录保存失败。";
        }
        const result = sent.map((message) => renderMessage(message, timezone, botIds));
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

    return result.text.trim();
  } catch (error) {
    logger.error("聊天媒体理解失败", {
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
