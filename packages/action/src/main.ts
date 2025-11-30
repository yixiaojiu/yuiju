import 'dotenv/config';
import { charactorState } from '@/state/charactor-state';
import { startRealtimeLoop } from '@/engine/runner';
import { logger } from '@/utils/logger';

async function main() {
  charactorState.reset();
  process.on('uncaughtException', err => {
    logger.error({ event: 'process.uncaughtException', error: String(err), stack: (err as any)?.stack });
  });
  process.on('unhandledRejection', reason => {
    logger.error({ event: 'process.unhandledRejection', error: String(reason) });
  });
  await startRealtimeLoop();
}

main();
