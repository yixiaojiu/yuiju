import { Blackboard, CoolingPolicy } from './types'

// 黑板：跨节点共享上下文（缓存、失败记录、最近行动时间等）

export const createBlackboard = (policies?: CoolingPolicy[]): Blackboard => ({
  llmCache: new Map(),
  lastActionTime: new Map(),
  failures: new Map(),
  cooldownPolicies: policies || []
})

export const setSelected = (bb: Blackboard, payload: Blackboard['selectedAction']) => {
  bb.selectedAction = payload
}

export const markActionTime = (bb: Blackboard, type: string, time: number) => {
  bb.lastActionTime.set(type, time)
}

export const getActionLastTime = (bb: Blackboard, type: string): number | undefined => {
  return bb.lastActionTime.get(type)
}

export const cacheLlmCandidates = (
  bb: Blackboard,
  key: string,
  candidates: Blackboard['llmCache'][string]['candidates'],
  time: number,
  reason?: string
) => {
  bb.llmCache.set(key, { time, candidates, reason })
}

export const getLlmCache = (bb: Blackboard, key: string) => {
  return bb.llmCache.get(key)
}

export const cacheFailure = (bb: Blackboard, key: string, time: number, reason: string) => {
  bb.failures.set(key, { time, reason })
}

export const getFailure = (bb: Blackboard, key: string) => {
  return bb.failures.get(key)
}
