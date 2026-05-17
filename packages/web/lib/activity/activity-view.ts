import { formatProjectTime, type IMemoryEpisode } from "@yuiju/utils";

export type ActivityTrigger = "agent" | "user" | "system";

export interface ActivityDetailField {
  label: string;
  value: string;
}

export interface ActivityItem {
  id: string;
  happenedAt: string;
  timeLabel: string;
  dateLabel: string;
  title: string;
  summary: string;
  trigger: ActivityTrigger;
  durationMinutes: number;
  episodeType: IMemoryEpisode["type"];
  source: IMemoryEpisode["source"];
  detailFields: ActivityDetailField[];
  payloadPreview: string;
}

/**
 * 将统一 Episode 转成 Web 动态页可直接消费的视图模型。
 *
 * 说明：
 * - 统一在这里做事件类型映射，避免页面组件散落业务判断；
 * - detailFields 面向 UI 展示，payloadPreview 则保留完整调试视图；
 * - 所有展示数据都从 MemoryEpisode 派生，不再依赖旧行为记录模型。
 */
export function mapEpisodeToActivityItem(episode: IMemoryEpisode): ActivityItem {
  const detailFields = buildDetailFields(episode);
  const formattedHappenedAt = formatProjectTime(episode.happenedAt, "YYYY-MM-DD HH:mm:ss");

  return {
    id: String(episode.id),
    happenedAt: episode.happenedAt.toISOString(),
    timeLabel: formattedHappenedAt,
    dateLabel: formattedHappenedAt,
    title: resolveActivityTitle(episode),
    summary: episode.summaryText,
    trigger: resolveActivityTrigger(episode),
    durationMinutes: Number(episode.payload.durationMinutes ?? 0),
    episodeType: episode.type,
    source: episode.source,
    detailFields,
    payloadPreview: JSON.stringify(
      {
        id: episode.id,
        source: episode.source,
        type: episode.type,
        subject: episode.subject,
        happenedAt: episode.happenedAt.toISOString(),
        summaryText: episode.summaryText,
        payload: episode.payload,
      },
      null,
      2,
    ),
  };
}

function resolveActivityTitle(episode: IMemoryEpisode): string {
  const payload = getPayloadObject(episode);

  if (episode.type === "behavior") {
    return String(payload.action ?? "行为");
  }
  if (episode.type === "conversation") {
    return `对话归档 · ${String(payload.counterpartyName ?? "未命名对象")}`;
  }
  if (episode.type.startsWith("plan_")) {
    const after = getNestedObject(payload.after);
    const before = getNestedObject(payload.before);
    const planScope = payload.planScope === "longTerm" ? "长期计划" : "短期计划";
    const planTitle = String(after.title ?? before.title ?? "未命名计划");
    return `${planScope} · ${planTitle}`;
  }
  if (episode.type === "system") {
    return String(payload.eventName ?? "系统事件");
  }
  return episode.type;
}

function resolveActivityTrigger(episode: IMemoryEpisode): ActivityTrigger {
  if (episode.source === "chat") {
    return "user";
  }
  if (episode.type === "system" || episode.source === "system") {
    return "system";
  }
  return "agent";
}

function buildDetailFields(episode: IMemoryEpisode): ActivityDetailField[] {
  const payload = getPayloadObject(episode);
  const fields: ActivityDetailField[] = [
    { label: "事件类型", value: episode.type },
    { label: "来源", value: episode.source },
    { label: "发生时间", value: formatProjectTime(episode.happenedAt, "YYYY-MM-DD HH:mm:ss") },
  ];

  if (episode.type === "conversation" && typeof payload.counterpartyName === "string") {
    fields.push({ label: "关联对象", value: payload.counterpartyName });
  }

  if (episode.type === "behavior") {
    fields.push(
      { label: "行为", value: String(payload.action ?? "未知行为") },
      { label: "原因", value: String(payload.reason ?? "无") },
      { label: "耗时", value: `${Number(payload.durationMinutes ?? 0)} 分钟` },
      { label: "地点", value: stringifyUnknown(payload.location) },
      { label: "关联计划", value: String(payload.relatedPlanId ?? "无") },
    );
  }

  if (episode.type === "conversation") {
    fields.push(
      { label: "消息数量", value: String(payload.messageCount ?? 0) },
      { label: "窗口起始", value: String(payload.windowStart ?? "无") },
      { label: "窗口结束", value: String(payload.windowEnd ?? "无") },
    );
  }

  if (episode.type.startsWith("plan_")) {
    const before = getNestedObject(payload.before);
    const after = getNestedObject(payload.after);
    const changeType = String(payload.changeType ?? "未知");
    const planScope =
      payload.planScope === "longTerm"
        ? "长期计划"
        : payload.planScope === "shortTerm"
          ? "短期计划"
          : String(payload.planScope ?? "未知");

    fields.push({ label: "计划范围", value: planScope }, { label: "变更类型", value: changeType });

    if (changeType === "created") {
      fields.push({ label: "新计划", value: String(after.title ?? "无") });
    } else if (changeType === "updated") {
      fields.push(
        { label: "原计划", value: String(before.title ?? "无") },
        { label: "新计划", value: String(after.title ?? "无") },
      );
    } else {
      fields.push(
        { label: "计划", value: String(before.title ?? after.title ?? "无") },
        { label: "结果状态", value: String(after.status ?? "无") },
      );
    }
  }

  if (episode.type === "system") {
    fields.push(
      { label: "事件名", value: String(payload.eventName ?? "系统事件") },
      { label: "变化量", value: String(payload.delta ?? "无") },
    );
  }

  return fields;
}

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return "无";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function getPayloadObject(episode: IMemoryEpisode): Record<string, unknown> {
  return typeof episode.payload === "object" && episode.payload !== null
    ? (episode.payload as Record<string, unknown>)
    : {};
}

function getNestedObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
