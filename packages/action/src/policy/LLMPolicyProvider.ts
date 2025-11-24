import type { Action } from '@/types';
import dayjs from 'dayjs';

export type LLMPolicyInput = {
  now: dayjs.Dayjs;
  state: unknown;
  memory: unknown;
};

export type LLMPolicyProvider = {
  getAction(input: LLMPolicyInput): Promise<Action | null> | Action | null;
};

export class SimplePolicyProvider implements LLMPolicyProvider {
  getAction(): Action | null {
    return null;
  }
}

