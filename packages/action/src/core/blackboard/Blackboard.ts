export class Blackboard {
  lastPolicyRequestAt: number | null = null;
  lastRejectedReasons: Map<string, number> = new Map();
  runningAction: string | null = null;
  cooldownMs = 180000;
  rateLimitPerMinutes = 1;
  nowOverride: number | null = null;

  private static instance: Blackboard | null = null;

  static getInstance() {
    if (!Blackboard.instance) Blackboard.instance = new Blackboard();
    return Blackboard.instance;
  }

  canRequestPolicy(nowMs: number) {
    if (this.lastPolicyRequestAt == null) return true;
    const windowMs = 60000 / Math.max(1, this.rateLimitPerMinutes);
    return nowMs - this.lastPolicyRequestAt >= windowMs;
  }

  markPolicyRequested(nowMs: number) {
    this.lastPolicyRequestAt = nowMs;
  }

  cacheRejection(key: string, nowMs: number) {
    this.lastRejectedReasons.set(key, nowMs);
  }

  isRecentlyRejected(key: string, nowMs: number) {
    const ts = this.lastRejectedReasons.get(key);
    if (!ts) return false;
    return nowMs - ts < this.cooldownMs;
  }
}

export const blackboard = Blackboard.getInstance();
