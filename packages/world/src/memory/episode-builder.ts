import type {
  ActionAgentDecision,
  ActionContext,
  MemoryEpisode,
  RunningActionState,
  WeatherSnapshot,
} from "@yuiju/utils";
import { ActionId, SUBJECT_NAME } from "@yuiju/utils";

export interface BuildBehaviorEpisodeInput {
  context: ActionContext;
  selectedAction: ActionAgentDecision;
  executionResult?: string;
  startContext?: Record<string, unknown>;
  durationMinutes: number;
  happenedAt: Date;
  isDev: boolean;
}

export interface BehaviorEpisodePayload extends Record<string, unknown> {
  action: ActionId;
  status: "running" | "completed";
  reason: string;
  executionResult?: string;
  durationMinutes: number;
  startContext?: Record<string, unknown>;
  completionContext?: Record<string, unknown>;
  eventDescription?: string;
  location: ActionContext["characterState"]["location"];
  characterStateSnapshot: ReturnType<ActionContext["characterState"]["log"]>;
}

interface WeatherChangedEpisodePayload {
  before: WeatherSnapshot;
  after: WeatherSnapshot;
}

/**
 * 构建开始运行中的行为 Episode。
 *
 * 说明：
 * - 当前只负责把 world 领域上下文映射为统一 Episode；
 * - 不负责真正写入 Graphiti，写入动作由上层 writer 决定。
 */
export function buildRunningBehaviorEpisode(
  input: BuildBehaviorEpisodeInput,
): MemoryEpisode<BehaviorEpisodePayload> | null {
  if (input.selectedAction.action === ActionId.Idle) {
    return null;
  }

  const summaryText = [
    `悠酱在${input.context.characterState.location.major}${input.context.characterState.location.minor ? `-${input.context.characterState.location.minor}` : ""}开始执行行为「${input.selectedAction.action}」`,
    `原因：${input.selectedAction.reason}`,
    input.executionResult ? `开始结果：${input.executionResult}` : undefined,
    `预计持续时间：${input.durationMinutes} 分钟`,
  ]
    .filter(Boolean)
    .join("；");

  return {
    source: "world_tick",
    type: "behavior",
    subject: SUBJECT_NAME,
    happenedAt: input.happenedAt,
    summaryText,
    isDev: input.isDev,
    payload: {
      action: input.selectedAction.action,
      status: "running",
      reason: input.selectedAction.reason,
      executionResult: input.executionResult,
      durationMinutes: input.durationMinutes,
      startContext: input.startContext,
      location: input.context.characterState.location,
      characterStateSnapshot: input.context.characterState.log(),
    },
  };
}

export interface BuildCompletedBehaviorEpisodeUpdateInput {
  context: ActionContext;
  runningAction: RunningActionState;
  runningPayload: BehaviorEpisodePayload;
  completionContext?: Record<string, unknown>;
  eventDescription?: string;
}

export function buildCompletedBehaviorEpisodeUpdate(
  input: BuildCompletedBehaviorEpisodeUpdateInput,
): Pick<MemoryEpisode<BehaviorEpisodePayload>, "summaryText" | "payload"> {
  const durationMinutes =
    typeof input.runningPayload.durationMinutes === "number"
      ? input.runningPayload.durationMinutes
      : Math.max(
          0,
          Math.round(
            (Date.parse(input.runningAction.waitUntil) -
              Date.parse(input.runningAction.actionStartedAt)) /
              60000,
          ),
        );

  const summaryText = [
    `悠酱在${input.context.characterState.location}完成了行为「${input.runningAction.action}」`,
    `原因：${input.runningPayload.reason}`,
    input.eventDescription ? `事件：${input.eventDescription}` : undefined,
    input.runningPayload.executionResult
      ? `结果：${input.runningPayload.executionResult}`
      : undefined,
    `持续时间：${durationMinutes} 分钟`,
  ]
    .filter(Boolean)
    .join("；");

  return {
    summaryText,
    payload: {
      ...input.runningPayload,
      action: input.runningAction.action,
      status: "completed",
      durationMinutes,
      startContext: input.runningAction.startContext ?? input.runningPayload.startContext,
      completionContext: input.completionContext,
      eventDescription: input.eventDescription,
      location: input.context.characterState.location,
      characterStateSnapshot: input.context.characterState.log(),
    },
  };
}

/**
 * 构建天气变化 Episode。
 *
 * 说明：
 * - 仅在天气类型或体感温度等级发生变化时写入；
 * - 只负责生成事件真相源，不再附带额外处理状态。
 */
export function buildWeatherChangedEpisode(input: {
  before: WeatherSnapshot | null;
  after: WeatherSnapshot;
  isDev: boolean;
}): MemoryEpisode<WeatherChangedEpisodePayload> | null {
  if (!input.before) {
    return null;
  }

  if (
    input.before.type === input.after.type &&
    input.before.temperatureLevel === input.after.temperatureLevel
  ) {
    return null;
  }

  return {
    source: "system",
    type: "weather_changed",
    subject: SUBJECT_NAME,
    happenedAt: new Date(input.after.periodStartAt),
    summaryText: [
      `天气从${input.before.type}变为${input.after.type}`,
      `体感从${input.before.temperatureLevel}变为${input.after.temperatureLevel}`,
      "接下来的外出、穿衣和活动安排需要参考这个变化",
    ].join("；"),
    isDev: input.isDev,
    payload: {
      before: input.before,
      after: input.after,
    },
  };
}
