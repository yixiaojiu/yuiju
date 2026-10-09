import { load_config } from "@yuiju/shared/config/load";

/** 第一版只展示悠乃；角色参数集中在入口，查询与数据结构仍按角色隔离。 */
export const dashboardCharacterId = "yuuno";

export async function getDeployment() {
  const config = await load_config();
  return {
    publicDeployment: config.app!.public_deployment!,
    source: config.app!.public_deployment ? ("sync" as const) : ("primary" as const),
    timezone: config.app!.timezone!,
    characterId: dashboardCharacterId,
    name: config.characters![dashboardCharacterId].name,
  };
}
