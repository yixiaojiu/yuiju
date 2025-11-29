import 'dotenv/config';
import { charactorState } from '@/state/charactor-state';
import { startRealtimeLoop } from '@/engine/runner';

async function main() {
  charactorState.reset();
  await startRealtimeLoop();
}

main();
