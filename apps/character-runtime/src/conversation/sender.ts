import { setTimeout as delay } from "node:timers/promises";
import type { ReplyTarget } from "./message";
import type { OneBotConnection } from "./onebot";
import { splitChatReply } from "./split-reply";

/**
 * 逐段发送并交还平台确认结果，调用方记录当前段后才继续发送下一段。
 * generationStartedAt 使用 performance.now()，首段从打字耗时中扣除已用的生成时间。
 */
export async function* sendReply(
  connection: OneBotConnection,
  channelId: string,
  text: string,
  target: ReplyTarget,
  generationStartedAt: number,
  beforeSend: () => Promise<void>,
) {
  const segments = splitChatReply(text);
  for (const [index, segment] of segments.entries()) {
    // 沿用旧规则：基础 1 秒 + 每字 200ms，抖动 ±180ms，限制在 400ms～10 秒。
    const typingMs = Math.round(
      Math.min(
        10_000,
        Math.max(400, 1000 + segment.trim().length * 200 + (Math.random() - 0.5) * 360),
      ),
    );
    const waitMs = index === 0 ? typingMs - (performance.now() - generationStartedAt) : typingMs;
    if (waitMs > 0) {
      await delay(waitMs);
    }
    // 只有第一段携带引用 / @，后续段只发正文，避免重复提醒。
    await beforeSend();
    yield await connection.sendText(channelId, segment, index === 0 ? target : {});
  }
}
