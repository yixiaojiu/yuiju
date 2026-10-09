import { setTimeout } from "node:timers/promises";
import { logger } from "../logger/logger";

/** 独立同步任务串行运行；失败明确记录，下一轮重试，不占用业务提交队列。 */
export function startSyncTask(name: string, intervalMs: number, sync: () => Promise<void>) {
  const stopping = new AbortController();
  async function run() {
    while (!stopping.signal.aborted) {
      try {
        await sync();
      } catch (error) {
        logger.error(`${name}失败`, { error });
      }
      try {
        await setTimeout(intervalMs, undefined, { signal: stopping.signal });
      } catch (error) {
        if (!stopping.signal.aborted) {
          throw error;
        }
      }
    }
  }
  const running = run();
  return async () => {
    stopping.abort();
    await running;
  };
}
