// 动作与场景相关类型定义，供决策与执行层使用
export enum ActionId {
  WAKE_UP = 'WAKE_UP',
  GO_TO_SCHOOL = 'GO_TO_SCHOOL',
  STUDY_AT_SCHOOL = 'STUDY_AT_SCHOOL',
  GO_HOME = 'GO_HOME',
  IDLE_AT_HOME = 'IDLE_AT_HOME',
  SLEEP = 'SLEEP',
}

export enum SceneId {
  MORNING = 'MORNING',
  SCHOOL = 'SCHOOL',
  HOME = 'HOME',
  EVENING = 'EVENING',
  WEEKEND = 'WEEKEND',
}

export type DecisionId = ActionId | 'NO_CHANGE';

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
