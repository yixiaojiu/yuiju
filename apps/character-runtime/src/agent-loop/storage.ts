import { getRedis } from "@yuiju/shared/database/redis";
import { characterKey, commitCharacterTransaction } from "../storage";
import type { AgentContextState } from "./context";
import type { CharacterEvent } from "./events";

/** 有副作用的工具调用；id 同时作为业务请求的去重标识，不依赖模型生成的调用 ID。 */
export type AgentAction = {
  id: string;
  name:
    | "respond_conversation"
    | "share"
    | "express_feeling"
    | "execute_action"
    | "create_plan"
    | "update_plan";
  input: unknown;
  createdAt: number;
  /** 缺失表示执行结果尚未持久确认；恢复时沿用原 id 与参数。 */
  result?: string;
};

export type AgentState = {
  context: AgentContextState;
  round: {
    id: string;
    events: CharacterEvent[];
    /** 旧世界 inbox 保留原 key，仅在整轮完成时确认本批记录。 */
    worldEventIds: string[];
    eventIds: string[];
  } | null;
};

export async function loadAgentState(characterId: string): Promise<AgentState | null> {
  const value = await (await getRedis()).get(`${characterKey(characterId)}:agent:state`);
  return value === null ? null : JSON.parse(value);
}

export async function saveAgentState(characterId: string, state: AgentState): Promise<void> {
  await (await getRedis()).set(`${characterKey(characterId)}:agent:state`, JSON.stringify(state));
}

/** Redis List 保留实际操作顺序；记录独立于完整上下文，只在本轮完成后清除。 */
export async function readAgentActions(
  characterId: string,
  roundId: string,
): Promise<AgentAction[]> {
  const values = await (await getRedis()).lrange(
    `${characterKey(characterId)}:agent:actions:${roundId}`,
    0,
    -1,
  );
  return values.map((value) => JSON.parse(value));
}

/** 执行前保存调用，返回 List 位置，执行后只更新这一条记录。 */
export async function appendAgentAction(
  characterId: string,
  roundId: string,
  action: AgentAction,
): Promise<number> {
  const length = await (await getRedis()).rpush(
    `${characterKey(characterId)}:agent:actions:${roundId}`,
    JSON.stringify(action),
  );
  return length - 1;
}

export async function saveAgentAction(
  characterId: string,
  roundId: string,
  index: number,
  action: AgentAction,
): Promise<void> {
  await (await getRedis()).lset(
    `${characterKey(characterId)}:agent:actions:${roundId}`,
    index,
    JSON.stringify(action),
  );
}

/** 完成输入与保存上下文同事务提交；本轮开始后收到的新事件不在删除范围内。 */
export async function finishAgentRound(characterId: string, state: AgentState): Promise<void> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const round = state.round!;
  const transaction = redis
    .multi()
    .set(`${key}:agent:state`, JSON.stringify({ ...state, round: null }))
    .del(`${key}:agent:actions:${round.id}`);
  if (round.eventIds.length) {
    transaction.hdel(`${key}:agent:inbox`, ...round.eventIds);
  }
  if (round.worldEventIds.length) {
    transaction.hdel(`${key}:world-inbox`, ...round.worldEventIds);
  }
  await commitCharacterTransaction(transaction);
}
