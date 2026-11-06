import { registerSkills } from "@yuiju/shared/llm/skill-runtime";
import { truncateToolOutput } from "@yuiju/shared/llm/tool-output";
import { logger } from "@yuiju/shared/logger/logger";
import { tool } from "ai";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { formatPeople, readPeople, updatePersonMemory } from "../../memory/people";
import { recallExperiences } from "../../memory/recall";
import { formatPlans } from "../../plan/plan";
import { readPlans } from "../../plan/storage";
import { createOnebotSkill } from "../../skills/onebot/skill";
import { queryTodayActivities } from "../../world/activities";
import {
  type ConversationMessage,
  type ConversationScope,
  type IncomingEvent,
  type ReplyTarget,
  renderMessage,
} from "../message";
import type { OneBotConnection } from "../onebot";
import type { Replyer } from "../reply/replyer";
import { sendReply } from "../reply/sender";
import type { StickerCollection } from "../sticker/collection";
import { plannerTools } from "./definitions";
import { understandMedia } from "./media";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

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
  stickers: StickerCollection;
  annotationResIds: string[];
  replyer: Replyer;
  /** 固定本轮收到的消息，执行期间仅追加已确认发送的事件。 */
  history: ConversationMessage[];
  /** 开始本轮时的历史边界；之后自己的发送先作为 Replyer 临时上下文，避免摘要跳过排队的新消息。 */
  historyThrough: number;
  /** 本轮收到 @ 当前机器人或引用回复机器人的消息，第三次质量检查失败也发送。 */
  receivedMentionOrReply: boolean;
  /** 将平台确认的事件写入真实历史和本轮快照，再持久化。 */
  recordSent: (events: IncomingEvent[]) => Promise<void>;
  /** 每次发送或 Skill 平台写入前，等待会话保存执行标记。 */
  beforeSend: () => Promise<void>;
  /** Replyer 应用新摘要后，由会话保存摘要和原文裁剪。 */
  saveReplyerSummary: () => Promise<void>;
  /** 进入平台发送或 Skill 写入前设置；结果未确认也不能重跑整个输入批次。 */
  sendAttempted: boolean;
  /** 本轮是否出现工具失败；失败不能计为主动沉默。 */
  failed: boolean;
  /** wait 成功时设置，Planner 停止后由 loop 安排唤醒。 */
  waitSeconds?: number;
};

/** 工具直接执行，返回值由 SDK 转为 tool message；不另行追加执行反馈。 */
export async function createPlannerTools(
  scope: ConversationScope,
  timezone: string,
  botIds: readonly string[],
  context: ConversationToolContext,
) {
  const currentGroup = await context.connection.api.getGroupInfo(scope.channelId);
  const skills = [
    createOnebotSkill({
      api: context.connection.api,
      selfId: context.connection.selfId,
      groupId: scope.channelId,
      groupName: currentGroup.group_name,
      groupWhitelistIds: context.connection.groupWhitelistIds,
      async beforeWrite() {
        await context.beforeSend();
        context.sendAttempted = true;
      },
      async onMessageDeleted(message) {
        await context.recordSent([
          {
            kind: "recall",
            recalledMessageId: String(message.message_id),
            senderId: String(message.sender.user_id),
            senderName: message.sender.nickname,
            operatorId: context.connection.selfId,
            timestamp: Date.now(),
            isSelf: true,
          },
        ]);
      },
    }),
  ];
  let sendQueue = Promise.resolve();

  return {
    ...registerSkills(skills),
    collectSticker: tool({
      ...plannerTools.collectSticker,
      async execute(input) {
        try {
          if (input.source.type === "message") {
            const messageId = input.source.messageId;
            if (
              !context.history.some(
                (message) => message.kind === "message" && message.id === messageId,
              )
            ) {
              throw new Error("来源消息不在当前真实交流中");
            }
          } else if (!context.annotationResIds.includes(input.source.resId)) {
            throw new Error("来源收藏不在已收到的待标注事件中");
          }
          return JSON.stringify(await context.stickers.collect(input, scope.channelId));
        } catch (error) {
          context.failed = true;
          logger.error("表情收藏未完整完成", { error });
          return `表情收藏未完整完成：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    listStickers: tool({
      ...plannerTools.listStickers,
      execute: async () => JSON.stringify(context.stickers.list()),
    }),
    sendMedia: tool({
      ...plannerTools.sendMedia,
      async execute({ id }) {
        const previous = sendQueue;
        let release!: () => void;
        sendQueue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const sent: IncomingEvent[] = [];
        let stage = "prepare-send";
        let failure: string | undefined;
        try {
          await context.stickers.send(
            scope.channelId,
            { id },
            async () => {
              await context.beforeSend();
              context.sendAttempted = true;
              stage = "send";
            },
            async (messages) => {
              sent.push(...messages);
              stage = "storage";
              await context.recordSent(messages);
            },
          );
        } catch (error) {
          context.failed = true;
          logger.error("媒体发送工具失败", { stage, sentCount: sent.length, error });
          failure = `媒体发送未完整完成（${stage}）：${error instanceof Error ? error.message : String(error)}。以下为已确认发送记录。`;
        } finally {
          release();
        }
        return [
          ...(failure ? [failure] : []),
          ...sent.map((message) => renderMessage(message, timezone, botIds)),
        ].join("\n");
      },
    }),
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
    query_today_activities: tool({
      ...plannerTools.query_today_activities,
      execute: async (input) => await queryTodayActivities(scope.characterId, input),
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
        // 回复和直接媒体发送共用队列，覆盖生成、发送与记录。
        const previousReply = sendQueue;
        let release!: () => void;
        sendQueue = new Promise<void>((resolve) => {
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
            context.stickers.list().flatMap((sticker) => sticker.tags),
            context.receivedMentionOrReply,
          );
          if (reply.status === "no_reply") {
            return "本次未发送：没有可发送的回复内容。";
          }
          if (reply.status === "quality_rejected") {
            return "本次未发送：Replyer 回复质量检查三次未通过。";
          }
          await sendReply(
            context.connection,
            context.stickers,
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
            async (events) => {
              // 先保留确认结果，历史或统计写入失败也不能抹去发送事实。
              sent.push(...events);
              stage = "storage";
              await context.recordSent(events);
            },
          );
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
        return result.length ? result.join("\n") : "本次未发送：没有可发送的文字或表情。";
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
