import { charactorState } from '@/state/charactor-state';
import { worldState } from '@/state/world-state';
import type { ActionId, ActionContext, LLMChoiceResult, DecisionId } from '@/types/action';
import { getAction, getRegisteredActions } from '@/config/action-registry';
import { getAllowedActions, getDefaultAction, resolveScene, getDefaultSceneCooldownSec } from '@/config/scene-policies';
import { shortTermMemory } from '@/memory/short-term';
import { llmClient } from '@/llm/llm-client';
import { resolveDecisionCandidates, nextGateDelayMs } from '@/config/decision-gates';
import { logger } from '@/utils/logger';

// 过滤当前场景允许且满足前置条件的动作集合
function filterExecutable(scene: ReturnType<typeof resolveScene>) {
  const allowedIds = new Set(getAllowedActions(scene));
  return getRegisteredActions()
    .filter(m => allowedIds.has(m.id))
    .filter(m => {
      try {
        return m.precondition();
      } catch {
        return false;
      }
    });
}

function isValidChoice(choice: LLMChoiceResult, allowedIds: Set<ActionId>) {
  if (!allowedIds.has(choice.action as ActionId)) return false;
  const meta = getAction(choice.action as ActionId);
  if (!meta) return false;
  try {
    return meta.precondition();
  } catch {
    return false;
  }
}

// 主决策循环：解析场景、LLM 选择、校验与执行、回退
export async function tick(
  retry = 2
): Promise<{ executed: DecisionId; reason: string; scene: string; nextDelayMs: number }> {
  
  const scene = resolveScene();
  let executables = filterExecutable(scene);

  const gate = resolveDecisionCandidates();
  if (!gate) {
    const delay = nextGateDelayMs();
    const def = getDefaultAction(scene);
    logger.debug({ event: 'gate.none', scene, nextDelayMs: delay, default: def });
    return { executed: def as DecisionId, reason: 'no-decision-needed', scene, nextDelayMs: delay } as any;
  }

  // 在决策门内：忽略通用回退逻辑，严格走候选集合

  // 仅在决策门内进行选择：候选包含真实动作与 NO_CHANGE
  const candidates = gate.candidates;
  const allowedReal = new Set<ActionId>(candidates.filter(c => c.id !== 'NO_CHANGE').map(c => c.id as ActionId));
  const ctx: ActionContext = {
    worldHour: worldState.time.hour(),
    location: charactorState.location as any,
    activity: charactorState.activity as any,
    scene,
    allowed: candidates.map(c => ({ id: c.id as DecisionId, description: c.description })),
    memory: shortTermMemory.list() as any,
  };

  for (let i = 0; i <= retry; i++) {
    const choice = await llmClient.chooseAction(ctx);
    if (choice.action === 'NO_CHANGE') {
      const c = candidates.find(x => x.id === 'NO_CHANGE');
      shortTermMemory.push({ action: 'NO_CHANGE', reason: choice.reason, ts: Date.now() });
      const cd = (c?.nextCheckSec ?? getDefaultSceneCooldownSec(scene)) * 1000;
      logger.info({ event: 'decision.no_change', scene, reason: choice.reason, nextDelayMs: cd });
      return { executed: 'NO_CHANGE', reason: choice.reason, scene, nextDelayMs: cd };
    }
    if (isValidChoice(choice as any, allowedReal)) {
      const meta = getAction(choice.action)!;
      meta.executor();
      shortTermMemory.push({ action: choice.action, reason: choice.reason, ts: Date.now() });
      const cd = (meta.cooldownSec ?? getDefaultSceneCooldownSec(scene)) * 1000;
      logger.info({ event: 'decision.executed', scene, action: choice.action, reason: choice.reason, nextDelayMs: cd });
      return { executed: choice.action, reason: choice.reason, scene, nextDelayMs: cd };
    }
  }

  // 仍不合法，使用场景默认动作回退
  const def = getDefaultAction(scene);
  const meta = getAction(def);
  if (meta && meta.precondition()) {
    meta.executor();
    const reason = `fallback: default action for scene ${scene}`;
    shortTermMemory.push({ action: def, reason, ts: Date.now() });
    const cd = (meta.cooldownSec ?? getDefaultSceneCooldownSec(scene)) * 1000;
    logger.warn({ event: 'decision.fallback.default', scene, action: def, reason, nextDelayMs: cd });
    return { executed: def as DecisionId, reason, scene, nextDelayMs: cd };
  }

  // 默认也不可执行，选取第一个可执行动作作为兜底
  executables = filterExecutable(scene);
  if (executables.length > 0) {
    const m = executables[0];
    m.executor();
    const reason = 'fallback: first executable';
    shortTermMemory.push({ action: m.id as ActionId, reason, ts: Date.now() });
    const cd = (m.cooldownSec ?? getDefaultSceneCooldownSec(scene)) * 1000;
    logger.warn({ event: 'decision.fallback.first', scene, action: m.id, reason, nextDelayMs: cd });
    return { executed: m.id as DecisionId, reason, scene, nextDelayMs: cd };
  }

  const cd = getDefaultSceneCooldownSec(scene) * 1000;
  logger.error({ event: 'decision.none', scene, nextDelayMs: cd });
  return { executed: def as DecisionId, reason: 'no-valid-choice-and-no-fallback', scene, nextDelayMs: cd } as any;
}
