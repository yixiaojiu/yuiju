import { setTimeout } from "node:timers/promises";
import { logger } from "@yuiju/shared/logger/logger";
import {
  archiveConversationMessages,
  MESSAGE_RETENTION_MS,
  pendingArchiveScopes,
  takePendingArchive,
} from "./storage";

const ARCHIVE_BATCH_SIZE = 100;
const ARCHIVE_INTERVAL_MS = 5_000;

/**
 * 每个角色进程只归档自己的会话，不扫描其他角色的积压。
 * 每轮扫描后等待五秒；每批失败即丢弃，停止只等当前批次，不排空全部积压。
 */
export function startConversationArchive(characterId: string) {
  const stopping = new AbortController();
  const task = runArchive(characterId, stopping.signal);
  return {
    async stop() {
      stopping.abort();
      await task;
    },
  };
}

async function runArchive(characterId: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      for await (const scope of pendingArchiveScopes(characterId)) {
        if (signal.aborted) {
          return;
        }
        try {
          let cursor = "0";
          do {
            const page = await takePendingArchive(scope, cursor);
            cursor = page.cursor;
            for (let offset = 0; offset < page.messages.length; offset += ARCHIVE_BATCH_SIZE) {
              if (signal.aborted) {
                return;
              }
              const batch = page.messages.slice(offset, offset + ARCHIVE_BATCH_SIZE);
              const cutoff = Date.now() - MESSAGE_RETENTION_MS;
              const pending = batch.filter((message) => message.timestamp > cutoff);
              if (!pending.length) {
                continue;
              }
              try {
                await archiveConversationMessages(scope, pending);
              } catch (error) {
                logger.error("会话归档失败，本批已消费，不再重试", {
                  count: pending.length,
                  error,
                });
              }
            }
          } while (cursor !== "0" && !signal.aborted);
        } catch (error) {
          logger.error("读取或移除待归档记录失败，本轮停止扫描", { error });
        }
      }
    } catch (error) {
      logger.error("发现待归档会话失败", { error });
    }
    try {
      await setTimeout(ARCHIVE_INTERVAL_MS, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
    }
  }
}
