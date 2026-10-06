import { anywhereActions } from "./anywhere";
import { businessActions } from "./business-district";
import { coastWalk } from "./coast-area";
import type { ActionDefinition } from "./definition";
import { homeActions } from "./home";
import { movement } from "./movement";
import { parkActions } from "./park-area";
import { study } from "./school";

/** 所有行动显式汇集；新增行动不会隐式注册或增加新的模型工具。 */
export const actions: readonly ActionDefinition[] = [
  movement,
  ...anywhereActions,
  ...homeActions,
  study,
  ...businessActions,
  ...parkActions,
  coastWalk,
];
export const actionsById: ReadonlyMap<string, ActionDefinition> = new Map(
  actions.map((action) => [action.id, action]),
);
