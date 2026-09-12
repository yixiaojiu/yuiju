import { webChatHistoryQuerySchema, webChatMessageInputSchema } from "@yuiju/utils/types/web-chat";
import { fetchWebChatHistory, sendWebChatMessage } from "@/lib/message-internal-api";
import { isPublicDeployment } from "@/lib/public-deployment";

export const runtime = "nodejs";
export const maxDuration = 120;

type ChatErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_QUERY"
  | "CHAT_DISABLED"
  | "CHAT_FAILED"
  | "MESSAGE_PENDING"
  | "MESSAGE_CONFLICT"
  | "MESSAGE_SUPERSEDED";

function errorResponse(status: number, code: ChatErrorCode, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  if (isPublicDeployment()) {
    return errorResponse(403, "CHAT_DISABLED", "Web 私聊渠道未启用");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_MESSAGE", "请求体必须是有效 JSON");
  }

  const input = webChatMessageInputSchema.safeParse(body);
  if (!input.success) {
    return errorResponse(400, "INVALID_MESSAGE", "消息格式不正确");
  }

  let result: Awaited<ReturnType<typeof sendWebChatMessage>>;
  try {
    result = await sendWebChatMessage(input.data);
  } catch (error) {
    console.error("Web chat internal API request failed", error);
    return errorResponse(502, "CHAT_FAILED", "悠酱暂时无法组织回复");
  }

  if (result.status === "failed") {
    return errorResponse(500, "CHAT_FAILED", "悠酱暂时无法组织回复");
  }
  if (result.status === "superseded") {
    return errorResponse(409, "MESSAGE_SUPERSEDED", "这条消息已被更新的消息替代");
  }
  if (result.status === "pending-conflict") {
    return errorResponse(409, "MESSAGE_PENDING", "这条消息仍在处理中");
  }
  if (result.status === "message-conflict") {
    return errorResponse(409, "MESSAGE_CONFLICT", "相同消息 ID 的内容不一致");
  }
  if (result.status === "no-reply") {
    return Response.json({ data: { status: "NO_REPLY" } });
  }

  return Response.json({
    data: {
      status: "REPLIED",
      reply: result.reply,
    },
  });
}

export async function GET(request: Request) {
  if (isPublicDeployment()) {
    return errorResponse(403, "CHAT_DISABLED", "Web 私聊渠道未启用");
  }

  const searchParams = new URL(request.url).searchParams;
  const cursorSentAt = searchParams.get("cursorSentAt");
  const cursorId = searchParams.get("cursorId");
  const query = webChatHistoryQuerySchema.safeParse({
    limit: Number(searchParams.get("limit")),
    cursor:
      cursorSentAt === null && cursorId === null
        ? undefined
        : { sentAt: Number(cursorSentAt), id: cursorId },
  });
  if (!query.success) {
    return errorResponse(400, "INVALID_QUERY", "历史记录游标不正确");
  }

  try {
    return Response.json({ data: await fetchWebChatHistory(query.data) });
  } catch (error) {
    console.error("Web chat history internal API request failed", error);
    return errorResponse(502, "CHAT_FAILED", "聊天记录暂时无法读取");
  }
}
