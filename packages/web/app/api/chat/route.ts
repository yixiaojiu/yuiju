import { flashModel, getCharacterCardPrompt, getRedis, getYuijuConfig } from "@yuiju/utils";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { isPublicDeployment } from "@/lib/public-deployment";

const DEFAULT_USER_NAME = "yixiaojiu";
const MAX_HISTORY = 20;

const PUBLIC_DAILY_TOTAL_LIMIT = 2000;
const PUBLIC_DAILY_IP_LIMIT = 200;
const PUBLIC_DAILY_TTL_SECONDS = 60 * 60 * 48;

type MessageMetadata = {
  createdAt?: number;
};

type DailyRateLimitResult =
  | { allowed: true; totalCount: number; ipCount: number }
  | { allowed: false; reason: "total" | "ip" };

// 关键函数：按北京时间计算每日 key，避免跨时区导致的额度错乱。
const getShanghaiDateKey = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((item) => item.type === "year")?.value ?? "0000";
  const month = parts.find((item) => item.type === "month")?.value ?? "00";
  const day = parts.find((item) => item.type === "day")?.value ?? "00";
  return `${year}${month}${day}`;
};

// 核心逻辑：从常见代理头获取 IP，优先使用第一个转发地址。
const getClientIP = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") || "unknown";
};

// 核心逻辑：对外展示时限制每日总量与 IP 额度，Redis 异常时放行。
const checkDailyRateLimit = async (clientIP: string): Promise<DailyRateLimitResult> => {
  const dateKey = getShanghaiDateKey();
  const totalKey = `public:chat:daily:${dateKey}`;
  const ipKey = `public:chat:daily:${dateKey}:${clientIP}`;

  try {
    const redis = getRedis();
    const results = await redis
      .multi()
      .incr(totalKey)
      .expire(totalKey, PUBLIC_DAILY_TTL_SECONDS)
      .incr(ipKey)
      .expire(ipKey, PUBLIC_DAILY_TTL_SECONDS)
      .exec();

    if (!results) {
      throw new Error("redis multi exec returned null");
    }

    const totalCount = Number(results?.[0]?.[1] ?? 0);
    const ipCount = Number(results?.[2]?.[1] ?? 0);

    if (!Number.isFinite(totalCount) || !Number.isFinite(ipCount)) {
      return { allowed: true, totalCount: 0, ipCount: 0 };
    }

    if (totalCount > PUBLIC_DAILY_TOTAL_LIMIT) {
      return { allowed: false, reason: "total" };
    }

    if (ipCount > PUBLIC_DAILY_IP_LIMIT) {
      return { allowed: false, reason: "ip" };
    }

    return { allowed: true, totalCount, ipCount };
  } catch (error) {
    console.error("Daily rate limit check failed:", error);
    return { allowed: true, totalCount: 0, ipCount: 0 };
  }
};

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const config = getYuijuConfig();

  if (!config.llm.deepseekApiKey.trim()) {
    return Response.json(
      {
        code: 503,
        data: null,
        message: "yuiju.config.ts 中未配置 llm.deepseekApiKey",
      },
      { status: 503 },
    );
  }

  const clientIP = getClientIP(request);

  if (isPublicDeployment()) {
    const rateLimit = await checkDailyRateLimit(clientIP);
    if (!rateLimit.allowed) {
      const message =
        rateLimit.reason === "total"
          ? "今日对话额度已用完，请明天再试"
          : "该 IP 今日对话额度已用完，请明天再试";
      return Response.json(
        {
          code: 429,
          data: null,
          message,
        },
        { status: 429 },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        code: 400,
        data: null,
        message: "invalid JSON body",
      },
      { status: 400 },
    );
  }

  const payload = body as { messages?: unknown; userName?: unknown };
  const trimmedUserName = typeof payload.userName === "string" ? payload.userName.trim() : "";
  const userName = trimmedUserName || DEFAULT_USER_NAME;

  const incomingMessages = Array.isArray(payload.messages)
    ? (payload.messages as UIMessage<MessageMetadata>[])
    : [];

  const recentMessages = incomingMessages.slice(-MAX_HISTORY);
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    modelMessages = await convertToModelMessages(recentMessages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid messages";
    return Response.json(
      {
        code: 400,
        data: null,
        message,
      },
      { status: 400 },
    );
  }

  const systemPrompt = getCharacterCardPrompt();

  const result = await streamText({
    model: flashModel,
    messages: modelMessages,
    system: systemPrompt,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({ createdAt: Date.now() }),
  });
}
