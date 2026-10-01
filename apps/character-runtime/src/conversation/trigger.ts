import { h } from "@satorijs/core";
import { type ConversationMessage, visibleText } from "./message";

export const RECHECK_INTERVAL_MS = 30_000;
// 第二次连续沉默开始退避，后续按顺序增长，最多五分钟。
export const BACKOFF_DELAYS_MS = [15, 30, 60, 120, 240, 300].map((seconds) => seconds * 1000);

export function isDirectedMessage(message: ConversationMessage, selfId: string, names: string[]) {
  if (message.kind === "poke") {
    return message.targetSenderId === selfId;
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
  directed: boolean;
  nextEligibleAt: number;
  now: number;
}) {
  const { pending, history, now } = input;
  // 被直接呼叫，或刚发言后的 15 秒内继续交流，不受评分和沉默退避限制。
  const latestSelf = [...history]
    .reverse()
    .find((message) => message.isSelf && message.kind === "message");
  if (input.directed || (latestSelf && now - latestSelf.timestamp <= 15_000)) {
    return { shouldRun: true, shouldRecheck: false, score: 0 };
  }

  // 内容分：问题、请求、征求意见和较长正文可以叠加；纯短反应统一降为 -25 分。
  const texts = pending.map((message) =>
    message.kind === "message" ? visibleText(message.content) : "",
  );
  const text = texts.join("\n").trim();
  let contentScore = 0;
  if (/[？?]|(?:吗|呢|么|嘛|怎么|为什么|为啥|啥|谁|哪(?:个|里)?|多少)(?:[？?。！!]|$)/.test(text)) {
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
    (message) => message.kind === "message" && now - message.timestamp <= 300_000,
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

  // 六条积压解除退避，但仍需达到 80 分；等待加分封顶且退避结束后无需继续空转复查。
  const score = contentScore + pressure + ageBonus - penalty;
  const eligible = pending.length >= 6 || now >= input.nextEligibleAt;
  return {
    shouldRun: eligible && score >= 80,
    shouldRecheck: pending.length > 0 && (ageBonus < 30 || !eligible),
    score,
  };
}
