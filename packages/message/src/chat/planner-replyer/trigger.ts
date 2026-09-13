import type { Session } from "@satorijs/core";
import { NICKNAME, SUBJECT_NAME } from "@yuiju/utils/constants/character";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export const ATTENTION_WINDOW_MS = 120 * 1000;
export const NECESSITY_THRESHOLD = 80;
export const BACKOFF_DELAYS_MS = [15, 30, 60, 120, 240, 300].map((seconds) => seconds * 1000);

const QUESTION_PATTERN =
  /[？?]|(?:吗|呢|么|嘛|怎么|为什么|为啥|啥|谁|哪(?:个|里)?|多少)(?:[？?。！!]|$)/;
const REQUEST_PATTERN = /(?:帮我|麻烦|能不能|可以帮|请你|求你|来个|发一下|看看|说说|告诉我|教我)/;
const OPINION_PATTERN = /(?:你觉得|你怎么看|你的看法|你认为|你会选|你喜欢哪|有什么想法)/;
const SHORT_REACTION_PATTERN =
  /^(?:哈+|嗯+|啊+|哦+|噢+|6+|草+|笑死|确实|好家伙|？+|\?+|。+|！+|!+)$/;

interface SatoriBotIdentity {
  selfId?: string;
  config?: { appId?: string };
}

export interface TriggerEvaluation {
  shouldRun: boolean;
  kind: "directed" | "attention" | "necessity" | "none";
  contentScore: number;
  messagePressureScore: number;
  idleBonus: number;
  recentPresencePenalty: number;
  totalScore: number;
}

export function isDirectedChatMessage(
  session: Session,
  message: StoredSatoriGroupMessage,
): boolean {
  if (message.content.some((segment) => segment.type === "poke")) {
    return true;
  }

  const bot = session.bot as SatoriBotIdentity;
  const selfIds = new Set(
    [session.selfId, bot.selfId, bot.config?.appId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
  const quote = session.quote ?? session.event.message?.quote;
  if (quote?.user?.id && selfIds.has(quote.user.id)) {
    return true;
  }

  if (
    (session.elements ?? []).some(
      (element) => element.type === "at" && selfIds.has(String(element.attrs.id)),
    )
  ) {
    return true;
  }

  const text = getVisibleText([message]);
  return text.includes(SUBJECT_NAME) || text.includes(NICKNAME);
}

export function evaluateChatTrigger(input: {
  pendingMessages: StoredSatoriGroupMessage[];
  history: readonly StoredSatoriGroupMessage[];
  forceTrigger: boolean;
  nextEligibleAt: number;
  now: number;
}): TriggerEvaluation {
  if (input.forceTrigger) {
    return result("directed", true, 0, 0, 0, 0);
  }

  let latestSelfMessage: StoredSatoriGroupMessage | undefined;
  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    if (input.history[index].sender.isSelf && input.history[index].origin === "planner-replyer") {
      latestSelfMessage = input.history[index];
      break;
    }
  }
  if (latestSelfMessage && input.now - latestSelfMessage.timestamp <= ATTENTION_WINDOW_MS) {
    return result("attention", true, 0, 0, 0, 0);
  }

  const text = getVisibleText(input.pendingMessages);
  let contentScore = 0;
  if (QUESTION_PATTERN.test(text)) contentScore += 15;
  if (REQUEST_PATTERN.test(text)) contentScore += 20;
  if (OPINION_PATTERN.test(text)) contentScore += 20;
  if (text.length >= 40) contentScore += 5;
  if (text.length >= 120) contentScore += 10;

  const visibleMessages = input.pendingMessages
    .map((message) => getVisibleText([message]).replaceAll(/\s/g, ""))
    .filter(Boolean);
  if (
    visibleMessages.length &&
    visibleMessages.every((message) => SHORT_REACTION_PATTERN.test(message))
  ) {
    contentScore = -25;
  }

  const pendingCount = input.pendingMessages.length;
  const messagePressureScore =
    pendingCount === 0
      ? 0
      : pendingCount === 1
        ? 50
        : Math.min(100, 50 + Math.round((50 * Math.log(pendingCount)) / Math.log(5)));
  const idleBonus = calculateIdleBonus(input.history, input.now);
  const recentPresencePenalty = calculatePresencePenalty(input.history, input.now);
  const totalScore = contentScore + messagePressureScore + idleBonus - recentPresencePenalty;
  const shouldRun = input.now >= input.nextEligibleAt && totalScore >= NECESSITY_THRESHOLD;

  return {
    shouldRun,
    kind: shouldRun ? "necessity" : "none",
    contentScore,
    messagePressureScore,
    idleBonus,
    recentPresencePenalty,
    totalScore,
  };
}

function calculateIdleBonus(history: readonly StoredSatoriGroupMessage[], now: number): number {
  const external = history.filter(
    (message) => !message.sender.isSelf && now - message.timestamp <= 30 * 60 * 1000,
  );
  if (external.length < 3) {
    return 0;
  }

  const intervals: number[] = [];
  for (let index = 1; index < external.length - 1; index += 1) {
    const interval = external[index].timestamp - external[index - 1].timestamp;
    if (interval >= 5000) {
      intervals.push(interval);
    }
  }
  if (!intervals.length) {
    return 0;
  }

  const average = Math.max(
    30_000,
    intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length,
  );
  const latest = external.at(-1)!;
  const previous = external.at(-2)!;
  return latest.timestamp - previous.timestamp >= average ? 15 : 0;
}

function calculatePresencePenalty(
  history: readonly StoredSatoriGroupMessage[],
  now: number,
): number {
  const recent = history.filter((message) => now - message.timestamp <= 5 * 60 * 1000);
  if (!recent.length) {
    return 0;
  }

  const ratio = recent.filter((message) => message.sender.isSelf).length / recent.length;
  if (ratio <= 0.25) return 0;
  if (ratio >= 0.6) return 25;
  return Math.round(((ratio - 0.25) / 0.35) * 25);
}

function getVisibleText(messages: readonly StoredSatoriGroupMessage[]): string {
  return messages
    .flatMap((message) => message.content)
    .map((segment) => {
      if (segment.type === "text") return segment.data.text;
      if (segment.type === "at") return `@${segment.data.displayName}`;
      if (segment.type === "face") return segment.data.faceText ?? "";
      if (segment.type === "image") return segment.data.description ?? "";
      if (segment.type === "poke" || segment.type === "recall") return segment.data.text;
      return "";
    })
    .join("\n")
    .trim();
}

function result(
  kind: TriggerEvaluation["kind"],
  shouldRun: boolean,
  contentScore: number,
  messagePressureScore: number,
  idleBonus: number,
  recentPresencePenalty: number,
): TriggerEvaluation {
  return {
    kind,
    shouldRun,
    contentScore,
    messagePressureScore,
    idleBonus,
    recentPresencePenalty,
    totalScore: contentScore + messagePressureScore + idleBonus - recentPresencePenalty,
  };
}
