import { setTimeout as delay } from "node:timers/promises";
import type { IncomingMessage, ReplyTarget } from "./message";
import type { OneBotConnection } from "./onebot";
import { splitChatReply } from "./split-reply";
import { parseStickerReply, type StickerCollection } from "./sticker";

/**
 * 逐段发送并等待调用方记录当前段，再继续下一段；最后发送表情。
 * generationStartedAt 使用 performance.now()，首段从打字耗时中扣除已用的生成时间。
 */
export async function sendReply(
  connection: OneBotConnection,
  stickers: StickerCollection,
  channelId: string,
  text: string,
  target: ReplyTarget,
  generationStartedAt: number,
  beforeSend: () => Promise<void>,
  recordSent: (messages: IncomingMessage[]) => Promise<void>,
): Promise<void> {
  const reply = parseStickerReply(
    text,
    stickers.list().flatMap((sticker) => sticker.tags),
  );
  const segments = splitChatReply(reply.text);
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
    await recordSent(await connection.sendText(channelId, segment, index === 0 ? target : {}));
  }
  if (reply.tag !== undefined) {
    await stickers.send(channelId, { tag: reply.tag }, beforeSend, recordSent);
  }
}
