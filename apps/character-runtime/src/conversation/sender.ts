import { setTimeout as delay } from "node:timers/promises";
import type { ReplyTarget } from "./message";
import type { OneBotConnection } from "./onebot";
import { splitChatReply } from "./split-reply";

/** 逐段发送并交还平台确认结果，调用方记录当前段后才继续发送下一段。 */
export async function* sendReply(
  connection: OneBotConnection,
  channelId: string,
  text: string,
  target: ReplyTarget,
) {
  const segments = splitChatReply(text);
  for (const [index, segment] of segments.entries()) {
    if (index > 0) {
      // 沿用旧规则：基础 1 秒 + 每字 200ms，抖动 ±180ms，限制在 400ms～10 秒。
      const milliseconds = Math.round(
        Math.min(
          10_000,
          Math.max(400, 1000 + segment.trim().length * 200 + (Math.random() - 0.5) * 360),
        ),
      );
      await delay(milliseconds);
    }
    // 第一段立即发送且携带引用 / @；后续段只发正文，避免重复提醒。
    yield await connection.sendText(channelId, segment, index === 0 ? target : {});
  }
}
