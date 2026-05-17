import { SUBJECT_NAME } from "../../constants";
import type { PlanChange } from "../../types";
import type { MemoryEpisode, MemoryEpisodeSource, MemoryEpisodeType } from "../episode";

export interface BuildPlanUpdateEpisodesInput {
  changes: PlanChange[];
  happenedAt: Date;
  isDev: boolean;
  source?: Extract<MemoryEpisodeSource, "world_tick" | "chat">;
  changeReasonPrefix?: string;
}

interface PlanLifecycleEpisodePayload {
  planId: string;
  planScope: "longTerm" | "shortTerm";
  changeType: PlanChange["changeType"];
  before?: {
    id: string;
    title: string;
    reason?: string;
    source?: string;
    expiresAt?: string;
  };
  after?: {
    id: string;
    title: string;
    reason?: string;
    source?: string;
    expiresAt?: string;
  };
  changeReason: string;
}

/**
 * 构建计划生命周期 Episode 列表。
 *
 * 说明：
 * - 每个 PlanChange 都映射为单独的 episode type，方便后续查询和事实提炼；
 * - payload 同时保留 before/after 快照，用于补偿重跑时恢复上下文。
 */
export function buildPlanUpdateEpisodes(
  input: BuildPlanUpdateEpisodesInput,
): MemoryEpisode<PlanLifecycleEpisodePayload>[] {
  return input.changes.flatMap((change) => {
    const episode = createPlanLifecycleEpisode({
      change,
      happenedAt: input.happenedAt,
      isDev: input.isDev,
      source: input.source ?? "world_tick",
      changeReasonPrefix: input.changeReasonPrefix ?? "本次 tick",
    });
    return episode ? [episode] : [];
  });
}

function createPlanLifecycleEpisode(input: {
  change: PlanChange;
  happenedAt: Date;
  isDev: boolean;
  source: Extract<MemoryEpisodeSource, "world_tick" | "chat">;
  changeReasonPrefix: string;
}): MemoryEpisode<PlanLifecycleEpisodePayload> | null {
  const { change } = input;
  if (shouldSkipPlanLifecycleEpisode(change)) {
    return null;
  }

  const scopeText = change.scope === "longTerm" ? "长期计划" : "短期计划";
  const actionText = describeChangeType(change.changeType);
  const episodeType = mapPlanChangeTypeToEpisodeType(change.changeType);
  const changeReason = `${input.changeReasonPrefix} ${actionText}${scopeText}`;

  return {
    source: input.source,
    type: episodeType,
    subject: SUBJECT_NAME,
    happenedAt: input.happenedAt,
    summaryText: buildPlanLifecycleSummaryText(change, scopeText, actionText, changeReason),
    isDev: input.isDev,
    payload: {
      planId: change.planId,
      planScope: change.scope,
      changeType: change.changeType,
      before: change.before
        ? {
            id: change.before.id,
            title: change.before.title,
            reason: change.before.reason,
            source: change.before.source,
            expiresAt: change.before.expiresAt,
          }
        : undefined,
      after: change.after
        ? {
            id: change.after.id,
            title: change.after.title,
            reason: change.after.reason,
            source: change.after.source,
            expiresAt: change.after.expiresAt,
          }
        : undefined,
      changeReason,
    },
  };
}

/**
 * 过滤不值得进入记忆层的计划更新事件。
 *
 * 说明：
 * - 方案 B 约定：只要标题未变化，就视为内部元数据同步，不写入 memory episode；
 * - 计划状态本身仍然会由 PlanManager 正常保存，这里只控制记忆层噪音。
 */
function shouldSkipPlanLifecycleEpisode(change: PlanChange): boolean {
  if (change.changeType !== "updated") {
    return false;
  }

  return !hasPlanTitleChanged(change);
}

function hasPlanTitleChanged(change: Pick<PlanChange, "before" | "after">): boolean {
  return change.before?.title !== change.after?.title;
}

/**
 * 根据不同生命周期事件生成更贴近业务语义的摘要文案。
 *
 * 说明：
 * - created / updated 关注“计划内容”；
 * - completed / abandoned 关注“原计划进入终态”，避免错误展示成“有了一个同名新计划”。
 */
function buildPlanLifecycleSummaryText(
  change: PlanChange,
  scopeText: string,
  actionText: string,
  changeReason: string,
): string {
  const prefix = `悠酱${actionText}${scopeText}`;
  const planReason = change.after?.reason ?? change.before?.reason;

  switch (change.changeType) {
    case "created":
      return [
        prefix,
        `新计划：${stringifyPlanValue(change.after?.title)}`,
        planReason && `计划理由：${planReason}`,
        `变化原因：${changeReason}`,
      ]
        .filter((item): item is string => Boolean(item))
        .join("；");
    case "updated":
      return [
        prefix,
        `原计划：${stringifyPlanValue(change.before?.title)}`,
        `新计划：${stringifyPlanValue(change.after?.title)}`,
        planReason && `计划理由：${planReason}`,
        `变化原因：${changeReason}`,
      ]
        .filter((item): item is string => Boolean(item))
        .join("；");
    case "completed":
      return [
        prefix,
        `计划：${stringifyPlanValue(change.before?.title)}`,
        "结果：已完成",
        planReason && `计划理由：${planReason}`,
        `变化原因：${changeReason}`,
      ]
        .filter((item): item is string => Boolean(item))
        .join("；");
    case "abandoned":
      return [
        prefix,
        `计划：${stringifyPlanValue(change.before?.title)}`,
        "结果：已放弃",
        planReason && `计划理由：${planReason}`,
        `变化原因：${changeReason}`,
      ]
        .filter((item): item is string => Boolean(item))
        .join("；");
    default:
      return prefix;
  }
}

function mapPlanChangeTypeToEpisodeType(changeType: PlanChange["changeType"]): MemoryEpisodeType {
  switch (changeType) {
    case "created":
      return "plan_created";
    case "updated":
      return "plan_updated";
    case "completed":
      return "plan_completed";
    case "abandoned":
      return "plan_abandoned";
    default:
      return "system";
  }
}

function stringifyPlanValue(value?: string | string[]): string {
  if (value === undefined) {
    return "无";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "空列表";
  }

  return value || "空字符串";
}

function describeChangeType(changeType: PlanChange["changeType"]): string {
  switch (changeType) {
    case "created":
      return "创建了";
    case "updated":
      return "更新了";
    case "completed":
      return "完成了";
    case "abandoned":
      return "放弃了";
    default:
      return "更新了";
  }
}
