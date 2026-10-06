import type { WorldFact } from "../events";
import type { WorldState } from "../state";

/** 环境只修改本轮状态副本、描述发生的变化；事实投递与持久化由 World 处理。 */
export type WorldAdvanceContext = {
  state: WorldState;
  /** 本轮推进目标的绝对时间，单位毫秒；恢复时可以是历史活动的结束时刻。 */
  now: number;
  timezone: string;
  events: Omit<WorldFact, "eventId" | "notifications">[];
};

/** 世界自身的演化规则，不执行角色活动，也不调用数据库或模型。 */
export abstract class WorldEvolution {
  abstract precondition(context: WorldAdvanceContext): boolean;
  abstract advance(context: WorldAdvanceContext): void;
}
