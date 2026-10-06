import type {
  Direction,
  PlaceRef,
  SpatialRelationView,
  TravelCost,
} from "@yuiju/shared/world/protocol";
import type { ActionCondition } from "./actions/definition";

export type PlaceDefinition = {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  /** 父地图坐标：x 向东、y 向北；根节点没有坐标。 */
  position: { x: number; y: number } | null;
  visibility: "public" | "private";
};
export type RouteDefinition = {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
  kind: "path" | "entrance";
  mode: "walk" | "train";
  durationMinutes: number;
  cost: TravelCost;
  conditions: ActionCondition[];
};
export type WorldMap = {
  placesById: ReadonlyMap<string, PlaceDefinition>;
  routesById: ReadonlyMap<string, RouteDefinition>;
  childrenByParentId: ReadonlyMap<string, readonly PlaceDefinition[]>;
  routesByFromPlaceId: ReadonlyMap<string, readonly RouteDefinition[]>;
};

/** 唯一的地图内容校验边界。定义有误直接失败，不推导或补齐通行关系。 */
export function createWorldMap(
  places: readonly PlaceDefinition[],
  routes: readonly RouteDefinition[],
): WorldMap {
  const placesById = new Map(places.map((place) => [place.id, place]));
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const childrenByParentId = new Map<string, PlaceDefinition[]>();
  const routesByFromPlaceId = new Map<string, RouteDefinition[]>();
  if (placesById.size !== places.length) {
    throw new Error("地图地点 ID 重复");
  }
  if (routesById.size !== routes.length) {
    throw new Error("地图路线 ID 重复");
  }
  if (places.filter((place) => place.parentId === null).length !== 1) {
    throw new Error("地图必须有且只有一个根地点");
  }

  for (const place of places) {
    childrenByParentId.set(place.id, []);
    routesByFromPlaceId.set(place.id, []);
    const ancestors = new Set<string>([place.id]);
    let parentId = place.parentId;
    while (parentId !== null) {
      const parent = placesById.get(parentId);
      if (!parent) {
        throw new Error(`地点 ${place.id} 引用了不存在的父地点 ${parentId}`);
      }
      if (ancestors.has(parentId)) {
        throw new Error(`地点 ${place.id} 的父子关系存在环`);
      }
      ancestors.add(parentId);
      parentId = parent.parentId;
    }
    if (
      place.parentId === null
        ? place.position !== null
        : !place.position ||
          !Number.isFinite(place.position.x) ||
          !Number.isFinite(place.position.y)
    ) {
      throw new Error(`地点 ${place.id} 的地图坐标无效`);
    }
  }
  for (const place of places) {
    if (place.parentId !== null) {
      childrenByParentId.get(place.parentId)!.push(place);
    }
  }
  const map: WorldMap = { placesById, routesById, childrenByParentId, routesByFromPlaceId };
  for (const route of routes) {
    const from = placesById.get(route.fromPlaceId);
    const to = placesById.get(route.toPlaceId);
    if (!from || !to) {
      throw new Error(`路线 ${route.id} 引用了不存在的端点`);
    }
    if (route.fromPlaceId === route.toPlaceId) {
      throw new Error(`路线 ${route.id} 的起终点相同`);
    }
    if (route.kind === "entrance") {
      if (from.parentId !== to.id && to.parentId !== from.id) {
        throw new Error(`入口 ${route.id} 必须连接直接父子地点`);
      }
    } else if (getPlacePath(map, from.id).length !== getPlacePath(map, to.id).length) {
      throw new Error(`路线 ${route.id} 跨层，需显式定义入口`);
    }
    if (
      [route.durationMinutes, ...Object.values(route.cost)].some(
        (value) => !Number.isFinite(value) || value < 0,
      )
    ) {
      throw new Error(`路线 ${route.id} 的时长或消耗无效`);
    }
    routesByFromPlaceId.get(from.id)!.push(route);
  }
  for (const outgoing of routesByFromPlaceId.values()) {
    outgoing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return map;
}

export function placeRef(place: PlaceDefinition): PlaceRef {
  return { placeId: place.id, name: place.name };
}

/** 从根到自身的路径；调用者已在输入边界确认地点存在及可知。 */
export function getPlacePath(map: WorldMap, placeId: string): PlaceDefinition[] {
  const path: PlaceDefinition[] = [];
  let currentId: string | null = placeId;
  while (currentId !== null) {
    const place: PlaceDefinition = map.placesById.get(currentId)!;
    path.push(place);
    currentId = place.parentId;
  }
  return path.reverse();
}

/** 私人分支需明确声明；补入祖先只用于归属展示，不能解锁兄弟分支。 */
export function getKnownPlaceIds(
  map: WorldMap,
  familiarPlaceIds: readonly string[],
  currentPlaceId: string | null,
): Set<string> {
  const declared = new Set(familiarPlaceIds);
  const known = new Set<string>();
  const pending = [...declared];
  while (pending.length) {
    const id = pending.pop()!;
    if (known.has(id)) {
      continue;
    }
    known.add(id);
    for (const child of map.childrenByParentId.get(id)!) {
      if (child.visibility === "public" || declared.has(child.id)) {
        pending.push(child.id);
      }
    }
  }
  if (currentPlaceId !== null) {
    known.add(currentPlaceId);
  }
  for (const id of [...known]) {
    for (const ancestor of getPlacePath(map, id)) {
      known.add(ancestor.id);
    }
  }
  return known;
}

/** 跨内部地图时比较共同祖先下的两个区域，不混算不同地图坐标。 */
export function getSpatialRelation(
  map: WorldMap,
  fromPlaceId: string,
  toPlaceId: string,
): SpatialRelationView {
  if (fromPlaceId === toPlaceId) {
    return { type: "same_place" };
  }
  const fromPath = getPlacePath(map, fromPlaceId);
  const toPath = getPlacePath(map, toPlaceId);
  let sharedDepth = 0;
  while (
    sharedDepth < fromPath.length &&
    sharedDepth < toPath.length &&
    fromPath[sharedDepth].id === toPath[sharedDepth].id
  ) {
    sharedDepth++;
  }
  if (sharedDepth === fromPath.length) {
    return { type: "contains" };
  }
  if (sharedDepth === toPath.length) {
    return { type: "inside" };
  }
  const from = fromPath[sharedDepth];
  const to = toPath[sharedDepth];
  const basis = {
    map: placeRef(fromPath[sharedDepth - 1]),
    from: placeRef(from),
    to: placeRef(to),
  };
  const dx = to.position!.x - from.position!.x;
  const dy = to.position!.y - from.position!.y;
  if (dx === 0 && dy === 0) {
    return { type: "overlapping_position", ...basis };
  }
  const directions: Direction[] = [
    "east",
    "northeast",
    "north",
    "northwest",
    "west",
    "southwest",
    "south",
    "southeast",
  ];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    type: "direction",
    direction: directions[((Math.floor((angle + 22.5) / 45) % 8) + 8) % 8],
    ...basis,
  };
}

/** 返回路段最少的已知有向路径；null 表示没有已知路径，不代表世界中不存在。 */
export function findKnownRoutePath(
  map: WorldMap,
  fromPlaceId: string,
  toPlaceId: string,
  knownPlaceIds: ReadonlySet<string>,
): RouteDefinition[] | null {
  if (fromPlaceId === toPlaceId) {
    return [];
  }
  const pending = [fromPlaceId];
  const visited = new Set(pending);
  const previous = new Map<string, RouteDefinition>();
  for (let index = 0; index < pending.length; index++) {
    for (const route of map.routesByFromPlaceId.get(pending[index])!) {
      if (!knownPlaceIds.has(route.toPlaceId) || visited.has(route.toPlaceId)) {
        continue;
      }
      visited.add(route.toPlaceId);
      previous.set(route.toPlaceId, route);
      if (route.toPlaceId === toPlaceId) {
        const path: RouteDefinition[] = [];
        let currentId = toPlaceId;
        while (currentId !== fromPlaceId) {
          const step = previous.get(currentId)!;
          path.push(step);
          currentId = step.fromPlaceId;
        }
        return path.reverse();
      }
      pending.push(route.toPlaceId);
    }
  }
  return null;
}
