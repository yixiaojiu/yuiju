import { setTimeout } from "node:timers/promises";
import { logger } from "@yuiju/shared/logger/logger";
import {
  archiveConversationMessages,
  MESSAGE_RETENTION_MS,
  pendingArchiveScopes,
  readPendingArchive,
  removePendingArchive,
} from "./storage";

const ARCHIVE_BATCH_SIZE = 100;
const ARCHIVE_INTERVAL_MS = 5_000;

/**
 * 应用只启动一个归档任务，覆盖当前环境的所有会话。
 * 每轮扫描后等待五秒；失败记录留待下一轮，停止只等当前批次，不排空全部积压。
 */
export function startConversationArchive() {
  const stopping = new AbortController();
  const task = runArchive(stopping.signal);
  return {
    async stop() {
      stopping.abort();
      await task;
    },
  };
}

async function runArchive(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      for await (const scope of pendingArchiveScopes()) {
        if (signal.aborted) return;
        try {
          let cursor = "0";
          do {
            const page = await readPendingArchive(scope, cursor);
            cursor = page.cursor;
            for (let offset = 0; offset < page.messages.length; offset += ARCHIVE_BATCH_SIZE) {
              if (signal.aborted) return;
              const batch = page.messages.slice(offset, offset + ARCHIVE_BATCH_SIZE);
              const cutoff = Date.now() - MESSAGE_RETENTION_MS;
              const expired = batch.filter((message) => message.timestamp <= cutoff);
              // 过期清理与归档确认分开；MongoDB 不可用时也能清理超期积压。
              await removePendingArchive(
                scope,
                expired.map((message) => message.sequence),
              );
              const pending = batch.filter((message) => message.timestamp > cutoff);
              if (!pending.length) continue;
              const confirmed = await archiveConversationMessages(scope, pending);
              await removePendingArchive(scope, confirmed);
            }
          } while (cursor !== "0" && !signal.aborted);
        } catch (error) {
          logger.error("会话后台归档失败，未确认记录保留到下一轮", { error });
        }
      }
    } catch (error) {
      logger.error("发现待归档会话失败", { error });
    }
    try {
      await setTimeout(ARCHIVE_INTERVAL_MS, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
