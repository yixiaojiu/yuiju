import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import type {
  InspectWorldResult,
  ObservationView,
  PositionView,
  RouteView,
  WorldEvent,
} from "@yuiju/shared/world/protocol";

function formatRoutes(routes: RouteView[]): string {
  return routes
    .map((route) =>
      [
        `${route.from.name} → ${route.to.name}（routeId=${route.routeId}），${route.mode === "walk" ? "步行" : "电车"} ${route.durationMinutes} 分钟，消耗 ${route.cost.money} 金币、${route.cost.stamina} 体力、${route.cost.satiety} 饱腹。`,
        ...route.conditions.map(
          (condition) =>
            `${condition.description}：${condition.status === "met" ? "当前满足" : condition.status === "unmet" ? "当前不满足" : "当前未知"}`,
        ),
      ].join("\n"),
    )
    .join("\n");
}
function formatPosition(position: PositionView, timezone: string): string {
  if (position.type === "moving") {
    return `正在从${position.from.name}前往${position.to.name}，预计 ${formatLlmDateTime(position.endsAt, timezone)} 到达。`;
  }
  return `位置：${position.hierarchy.map((place) => place.name).join(" / ")}（placeId=${position.place.placeId}）`;
}
function formatObservation(observation: ObservationView): string {
  if (observation.status === "not_observed") {
    return "没有该地点的现场感知。";
  }
  return [
    `天气：${observation.weather}`,
    `地点状态：${observation.isOpen ? "开放" : "关闭"}`,
    `现场资源：${observation.resources.map((item) => `${item.name} ${item.quantity}`).join("、") || "无"}`,
  ].join("\n");
}

/** 供角色 loop 注入事件；现场信息使用发生时的快照，与主动查询采用相同表达。 */
export async function formatWorldEvent(event: WorldEvent): Promise<string> {
  const timezone = (await load_config()).app!.timezone!;
  return [
    `事件时间：${formatLlmDateTime(event.occurredAt, timezone)}`,
    event.description,
    formatPosition(event.position, timezone),
    ...(event.observation ? [formatObservation(event.observation)] : []),
  ].join("\n");
}

/** 程序按固定结构表达地图；不让模型读取内部坐标，也不额外调用模型翻译。 */
export async function formatWorldView(view: InspectWorldResult): Promise<string> {
  const timezone = (await load_config()).app!.timezone!;
  if (view.type === "current") {
    return [
      formatLlmDateTime(view.now, timezone),
      formatPosition(view.position, timezone),
      `体力 ${view.body.stamina}，饱腹 ${view.body.satiety}，金币 ${view.money}，手机电量 ${view.phoneBattery}%。`,
      `背包：${view.inventory.map((item) => `${item.name}（itemId=${item.itemId}）${item.quantity} 份`).join("、") || "空"}`,
      view.activity
        ? `正在${view.activity.actionId}，预计 ${formatLlmDateTime(view.activity.endsAt, timezone)} 结束。`
        : "当前没有进行中的活动。",
      formatObservation(view.observation),
      formatRoutes(view.routes),
      `可了解的行动：\n${view.actions.map((action) => `${action.actionId}：${action.description}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (view.type === "place") {
    return [
      `位置：${view.hierarchy.map((place) => place.name).join(" / ")}（placeId=${view.place.placeId}）`,
      view.description,
      view.openingHours
        ? `常规开放时间：${String(view.openingHours[0]).padStart(2, "0")}:00–${String(view.openingHours[1]).padStart(2, "0")}:00。`
        : "常规全天开放。",
      `内部已知地点：${view.children.map((place) => `${place.name}（placeId=${place.placeId}）`).join("、") || "无"}`,
      formatObservation(view.observation),
      formatRoutes(view.routes),
      `可了解的行动：\n${view.actions.map((action) => `${action.actionId}：${action.description}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (view.type === "relation") {
    const directions = {
      east: "东",
      northeast: "东北",
      north: "北",
      northwest: "西北",
      west: "西",
      southwest: "西南",
      south: "南",
      southeast: "东南",
    };
    const spatial = view.spatial;
    let relation: string;
    if (spatial.type === "direction")
      relation = `${spatial.to.name}在${spatial.from.name}的${directions[spatial.direction]}方向（比较范围：${spatial.map.name}）。`;
    else if (spatial.type === "contains") relation = `${view.to.name}位于${view.from.name}内部。`;
    else if (spatial.type === "inside") relation = `${view.from.name}位于${view.to.name}内部。`;
    else if (spatial.type === "same_place") relation = "这是同一个地点。";
    else relation = "地图布局位置重合，无法区分方位。";
    const path =
      view.path.status === "found"
        ? `一条已知路径（${view.path.totalDurationMinutes} 分钟）：\n${formatRoutes(view.path.steps)}`
        : view.path.status === "no_known_path"
          ? "没有已知连接路径。"
          : "无需移动。";
    return [
      `${view.from.name}（placeId=${view.from.placeId}）→ ${view.to.name}（placeId=${view.to.placeId}）`,
      relation,
      view.directRoutes.length
        ? `直达路线：\n${formatRoutes(view.directRoutes)}`
        : "没有已知直达路线。",
      view.path.status === "found" && view.path.steps.length === 1 ? "" : path,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const labels = {
    met: "满足",
    unmet: "不满足",
    unknown: "未知",
    needs_parameters: "需要选择参数",
  };
  return [
    `行动：${view.actionId}`,
    view.description,
    `耗时：${view.durationDescription}`,
    ...view.conditions.map((condition) => `${condition.description}：${labels[condition.status]}`),
    `参数 schema：${JSON.stringify(view.payloadSchema)}`,
    `可知选项：${JSON.stringify(view.options)}`,
  ].join("\n");
}
