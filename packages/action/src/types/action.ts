// 动作与场景相关类型定义，供决策与执行层使用
export type ActionId =
  | 'WAKE_UP'
  | 'GO_TO_SCHOOL'
  | 'STUDY_AT_SCHOOL'
  | 'GO_HOME'
  | 'IDLE_AT_HOME'
  | 'SLEEP';

export type SceneId = 'MORNING' | 'SCHOOL' | 'HOME' | 'EVENING';

export type DecisionId = ActionId | 'NO_CHANGE';

export type GateId = 'MORNING_WAKE' | 'GO_TO_SCHOOL' | 'GO_HOME' | 'EVENING_SLEEP';

export interface ActionContext {
  worldHour: number;
  location: string;
  activity: string;
  scene: SceneId;
  allowed: Array<{ id: DecisionId; description: string }>;
  memory: Array<{ action: DecisionId; reason: string; ts: number }>;
}

export interface ActionMetadata {
  id: ActionId;
  scenes: SceneId[];
  description: string;
  precondition: () => boolean;
  executor: () => void;
  priority?: number;
  cooldownSec?: number;
}

export interface LLMChoiceResult {
  action: DecisionId;
  reason: string;
}
