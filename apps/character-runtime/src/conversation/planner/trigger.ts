import { h } from "@satorijs/core";
import { logger } from "@yuiju/shared/logger/logger";
import type { ConversationInputEvent } from "../events";
import { type ConversationMessage, visibleText } from "../message";
import type { ConversationRuntime } from "../storage/redis";

export const RECHECK_INTERVAL_MS = 30_000;
// 第二次连续沉默开始退避，后续按顺序增长，最多五分钟。
export const BACKOFF_DELAYS_MS = [15, 30, 60, 120, 240, 300].map((seconds) => seconds * 1000);

export function isDirectedMessage(message: ConversationMessage, selfId: string, names: string[]) {
  if (message.kind === "poke") {
    return message.targetSenderId === selfId;
  }
  // 撤回是普通事件，不视为直接呼叫；沿用积压、等待时间等触发评分。
  if (message.kind === "recall") {
    return false;
  }
  if (message.quote?.senderId === selfId) {
    return true;
  }

  // @ 可能嵌在 XHTML 子节点中；昵称只匹配可见正文，不匹配媒体属性。
  const hasMention = (nodes: h[]): boolean =>
    nodes.some(
      (node) =>
        (node.type === "at" && String(node.attrs.id) === selfId) || hasMention(node.children),
    );
  if (hasMention(h.parse(message.content))) {
    return true;
  }
  const text = visibleText(message.content);
  return names.some((name) => text.includes(name));
}

/** 只计算是否值得规划及是否需要定时复查；不修改会话状态，也不调用模型。 */
export function evaluateTrigger(input: {
  pending: ConversationMessage[];
  history: ConversationMessage[];
  selfId: string;
  names: string[];
  botIds: readonly string[];
  nextEligibleAt: number;
  now: number;
}) {
  const { history, now, botIds } = input;
  // 混合输入按普通用户的消息独立判断；bot 仍保留在交给模型的完整上下文中。
  const userMessages = input.pending.filter((message) => !botIds.includes(message.senderId));
  const pending = userMessages.length ? userMessages : input.pending;
  const botOnly = pending.length > 0 && userMessages.length === 0;
  const directed = pending.some((message) => isDirectedMessage(message, input.selfId, input.names));
  const threshold = botOnly ? 100 : 80;
  const triggerDetails = {
    threshold,
    botOnly,
    scoredMessageCount: pending.length,
    /** 只有普通用户直接呼叫可以提前结束 Planner 的主动等待。 */
    interruptsWait: !botOnly && directed,
  };
  // bot 不走直接呼叫和发言后 15 秒的快速通道，避免双方持续接话刷新放行窗口。
  const latestSelf = [...history]
    .reverse()
    .find((message) => message.isSelf && message.kind === "message");
  if (
    !botOnly &&
    pending.length > 0 &&
    (directed || (latestSelf && now - latestSelf.timestamp <= 15_000))
  ) {
    return {
      ...triggerDetails,
      shouldRun: true,
      shouldRecheck: false,
      score: 0,
      scoreDetails: undefined,
      reason: directed ? "被直接呼叫" : "继续刚才的交流",
    };
  }

  // 内容分：问题、请求、征求意见和较长正文可以叠加；纯短反应统一降为 -25 分。
  const texts = pending.map((message) =>
    message.kind === "message" ? visibleText(message.content) : "",
  );
  const text = texts.join("\n").trim();
  let contentScore = 0;
  if (/[？?]|怎么|为什么|为啥|(?:吗|呢|么|嘛|啥|谁|哪(?:个|里)?|多少)(?:[？?。！!]|$)/.test(text)) {
    contentScore += 15;
  }
  if (/(?:帮我|麻烦|能不能|可以帮|请你|求你|来个|发一下|看看|说说|告诉我|教我)/.test(text)) {
    contentScore += 20;
  }
  if (/(?:你觉得|你怎么看|你的看法|你认为|你会选|你喜欢哪|有什么想法)/.test(text)) {
    contentScore += 20;
  }
  if (text.length >= 40) {
    contentScore += 5;
  }
  if (text.length >= 120) {
    contentScore += 10;
  }
  const visible = texts.map((value) => value.replaceAll(/\s/g, "")).filter(Boolean);
  if (
    visible.length &&
    visible.every((value) =>
      /^(?:哈+|嗯+|啊+|哦+|噢+|6+|草+|笑死|确实|好家伙|？+|\?+|。+|！+|!+)$/.test(value),
    )
  ) {
    contentScore = -25;
  }

  // 消息积压从单条 50 分开始按对数增长，到五条达到 100 分上限。
  let pressure = 0;
  if (pending.length === 1) {
    pressure = 50;
  } else if (pending.length > 1) {
    pressure = Math.min(100, 50 + Math.round((50 * Math.log(pending.length)) / Math.log(5)));
  }

  // 最早输入每等 30 秒增加 15 分，最多 30 分，使冷场也有重新评估的机会。
  const ageBonus = pending.length
    ? Math.min(30, Math.floor((now - pending[0].timestamp) / RECHECK_INTERVAL_MS) * 15)
    : 0;

  // 近五分钟发言占比超过 25% 后逐渐扣分，达到 60% 时扣满 25 分，避免持续抢话。
  const recent = history.filter(
    (message) =>
      message.kind === "message" &&
      now - message.timestamp <= 300_000 &&
      (botOnly || message.isSelf || !botIds.includes(message.senderId)),
  );
  const selfMessageRatio = recent.length
    ? recent.filter((message) => message.isSelf).length / recent.length
    : 0;
  let penalty = 0;
  if (selfMessageRatio >= 0.6) {
    penalty = 25;
  } else if (selfMessageRatio > 0.25) {
    penalty = Math.round(((selfMessageRatio - 0.25) / 0.35) * 25);
  }

  // bot 的直接呼叫只加分；六条参与评分的消息可解除退避，但仍需达到对应阈值。
  const directedBonus = botOnly && directed ? 20 : 0;
  const score = contentScore + pressure + ageBonus + directedBonus - penalty;
  const eligible = pending.length >= 6 || now >= input.nextEligibleAt;
  return {
    ...triggerDetails,
    shouldRun: eligible && score >= threshold,
    shouldRecheck: pending.length > 0 && (ageBonus < 30 || !eligible),
    score,
    scoreDetails: { contentScore, pressure, ageBonus, directedBonus, penalty },
    reason: !eligible ? "沉默冷却中" : score >= threshold ? "触发评分达标" : "触发评分不足",
  };
}

/** 判断阶段只给出输入快照或下次检查时间，不创建定时器、不修改状态。 */
export type NextRound = {
  input?: {
    messages: ConversationMessage[];
    history: ConversationMessage[];
    throughSequence: number;
    agentEvents: ConversationInputEvent[];
  };
  /** 等待实际秒数；0 也表示结束等待。 */
  waitedSeconds?: number;
  nextCheckAt?: number;
};

export function getNextRound(input: {
  now: number;
  pending: ConversationMessage[];
  history: ConversationMessage[];
  runtime: ConversationRuntime;
  selfId: string;
  names: string[];
  botIds: readonly string[];
}): NextRound {
  const { now, pending, history, runtime, selfId, names, botIds } = input;
  const agentEvents = (runtime.agentEvents ?? []).filter((event) => !event.consumed);
  const { waiting, failedThroughSequence, currentRound } = runtime;
  const trigger = evaluateTrigger({
    pending,
    history,
    selfId,
    names,
    botIds,
    nextEligibleAt: runtime.silenceCooldownUntil,
    now,
  });
  let waitedSeconds: number | undefined;
  if (waiting) {
    if (now < waiting.until && !trigger.interruptsWait && !agentEvents.length) {
      logger.info("Planner 继续等待", {
        pendingCount: pending.length,
        recheckAfterSeconds: Math.ceil((waiting.until - now) / 1000),
      });
      return { nextCheckAt: waiting.until };
    }
    waitedSeconds = (now - waiting.startedAt) / 1000;
  }
  if (!pending.length && !agentEvents.length && waitedSeconds === undefined && !currentRound) {
    return {};
  }
  if (
    failedThroughSequence !== undefined &&
    !agentEvents.length &&
    !pending.some((message) => message.sequence > failedThroughSequence)
  ) {
    logger.info("Planner 暂不运行", {
      reason: "上轮失败，等待新输入后再处理",
      pendingCount: pending.length,
    });
    return { waitedSeconds };
  }
  if (!currentRound && !agentEvents.length && waitedSeconds === undefined && !trigger.shouldRun) {
    logger.info("Planner 触发判断", {
      shouldRun: false,
      reason: trigger.reason,
      pendingCount: pending.length,
      score: trigger.score,
      threshold: trigger.threshold,
      botOnly: trigger.botOnly,
      scoredMessageCount: trigger.scoredMessageCount,
      ...trigger.scoreDetails,
      cooldownSeconds: Math.max(0, Math.ceil((runtime.silenceCooldownUntil - now) / 1000)),
      recheckAfterSeconds: trigger.shouldRecheck ? RECHECK_INTERVAL_MS / 1000 : null,
    });
    return { nextCheckAt: trigger.shouldRecheck ? now + RECHECK_INTERVAL_MS : undefined };
  }
  // 恢复轮次、主 loop 事件和等待结束可以绕过评分，日志记录实际放行原因。
  logger.info("Planner 触发判断", {
    shouldRun: true,
    reason: currentRound
      ? "恢复未完成轮次"
      : agentEvents.length
        ? "收到内部事件"
        : waitedSeconds !== undefined
          ? "结束主动等待，继续处理"
          : trigger.reason,
    pendingCount: pending.length,
    ...(!currentRound && !agentEvents.length && waitedSeconds === undefined && trigger.scoreDetails
      ? {
          score: trigger.score,
          threshold: trigger.threshold,
          botOnly: trigger.botOnly,
          scoredMessageCount: trigger.scoredMessageCount,
          ...trigger.scoreDetails,
        }
      : {}),
  });
  const throughSequence = pending.at(-1)?.sequence ?? runtime.processedThrough;
  return {
    input: {
      messages: pending,
      history: history.filter((message) => message.sequence <= throughSequence || message.isSelf),
      throughSequence,
      agentEvents,
    },
    waitedSeconds,
  };
}
