import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import type {
  InspectWorldResult,
  ObservationView,
  PlaceRef,
  PositionView,
  RouteView,
  WorldEvent,
} from "@yuiju/shared/world/protocol";

/** 地点引用始终携带名称与准确 ID，供后续查询直接使用。 */
function formatPlace(place: PlaceRef): string {
  return `${place.name}（placeId=${place.placeId}）`;
}

function formatRoutes(routes: RouteView[]): string {
  return routes
    .map((route) =>
      [
        `${formatPlace(route.from)} → ${formatPlace(route.to)}（routeId=${route.routeId}），${route.mode === "walk" ? "步行" : "电车"} ${route.durationMinutes} 分钟，消耗 ${route.cost.money} 金币、${route.cost.stamina} 体力、${route.cost.satiety} 饱腹。`,
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
    return `正在从${formatPlace(position.from)}前往${formatPlace(position.to)}，预计 ${formatLlmDateTime(position.endsAt, timezone)} 到达。`;
  }
  return `位置：${position.hierarchy.map(formatPlace).join(" / ")}`;
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
  if (view.type === "places") {
    if (view.places.length === 0) {
      return '你的熟悉范围内没有匹配的地点。你可以更换关键词，或调用 inspect_world({"type":"places"}) 查看全部熟悉地点。';
    }
    return [
      "熟悉地点：",
      ...view.places.map(
        (item) => `${item.hierarchy.map(formatPlace).join(" / ")}：${item.description}`,
      ),
    ].join("\n");
  }
  if (view.type === "current") {
    return [
      formatLlmDateTime(view.now, timezone),
      formatPosition(view.position, timezone),
      `体力 ${view.body.stamina}，饱腹 ${view.body.satiety}，金币 ${view.money}，手机电量 ${view.phoneBattery}%。`,
      `背包：${view.inventory.map((item) => `${item.name}（itemId=${item.itemId}）${item.quantity} 份`).join("、") || "空"}`,
      view.activity?.actionId === "空闲发呆"
        ? "发呆中，暂时没有安排，可以随时选择行动。"
        : view.activity
          ? `正在${view.activity.actionId}，预计 ${formatLlmDateTime(view.activity.endsAt!, timezone)} 结束。`
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
      `位置：${view.hierarchy.map(formatPlace).join(" / ")}`,
      view.description,
      view.openingHours
        ? `常规开放时间：${String(view.openingHours[0]).padStart(2, "0")}:00–${String(view.openingHours[1]).padStart(2, "0")}:00。`
        : "常规全天开放。",
      `内部已知地点：${view.children.map(formatPlace).join("、") || "无"}`,
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
    if (spatial.type === "direction") {
      relation = `${formatPlace(spatial.to)}在${formatPlace(spatial.from)}的${directions[spatial.direction]}方向（比较范围：${formatPlace(spatial.map)}）。`;
    } else if (spatial.type === "contains") {
      relation = `${formatPlace(view.to)}位于${formatPlace(view.from)}内部。`;
    } else if (spatial.type === "inside") {
      relation = `${formatPlace(view.from)}位于${formatPlace(view.to)}内部。`;
    } else if (spatial.type === "same_place") {
      relation = "这是同一个地点。";
    } else {
      relation = "地图布局位置重合，无法区分方位。";
    }
    const path =
      view.path.status === "found"
        ? `一条已知路径（${view.path.totalDurationMinutes} 分钟）：\n${formatRoutes(view.path.steps)}`
        : view.path.status === "no_known_path"
          ? "没有已知连接路径。"
          : "无需移动。";
    return [
      `${formatPlace(view.from)} → ${formatPlace(view.to)}`,
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
    view.place ? `查询地点：${formatPlace(view.place)}` : "查询地点：移动中，无当前地点。",
    view.description,
    `耗时：${view.durationDescription}`,
    ...view.conditions.map((condition) => `${condition.description}：${labels[condition.status]}`),
    `参数 schema：${JSON.stringify(view.payloadSchema)}`,
    `可知选项：${JSON.stringify(view.options)}`,
  ].join("\n");
}
