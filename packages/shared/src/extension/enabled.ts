import type { Config } from "../config/schema";

/** 登记关系由配置 schema 校验；角色未声明或未显式开启时，不提供扩展能力。 */
export function isExtensionEnabled(
  character: NonNullable<Config["characters"]>[string],
  extensionName: string,
) {
  return character.extensions?.[extensionName]?.enabled === true;
}
