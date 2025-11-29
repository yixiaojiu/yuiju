import type { ActionId, SceneId, GateId } from '@/types/action';

export enum PartOfDay {
  NIGHT = 'night',
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
}

export enum WorldActivity {
  SCHEOOL = 'school',
}

export interface TimeWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface GatesConfig {
  morningWakeWindow: TimeWindow;
  goToSchoolWindow: TimeWindow;
  goHomeAfterHour: number;
  eveningSleepAfterHour: number;
  noChangeNextSec: Record<GateId, number>;
  nextGateTargets: Array<{ hour: number; minute: number }>;
  minNextGateDelayMs: number;
}

export interface ScenesConfig {
  morningWindow: TimeWindow;
  schoolWindow: TimeWindow;
  afterSchoolWindow: TimeWindow;
  eveningStartHour: number;
  defaultSceneCooldownSec: Record<SceneId, number>;
}

export interface ActionsTimeConfig {
  wakeUpEarliestHour: number;
  wakeUpLatestHour: number;
}

export interface ActionsConfig {
  cooldownSec: Record<ActionId, number>;
}

export interface MemoryConfig {
  shortTermCapacity: number;
}

export interface RunnerConfig {
  initialDelayMs: number;
}

export interface SimulationConfig {
  startHour: number;
  endHour: number;
  stepHours: number;
}

export interface TimeConfig {
  gates: GatesConfig;
  scenes: ScenesConfig;
  actionsTime: ActionsTimeConfig;
  actions: ActionsConfig;
  memory: MemoryConfig;
  runner: RunnerConfig;
  simulation: SimulationConfig;
}
