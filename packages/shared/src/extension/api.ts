import type { Hono } from "hono";
import type { ExtensionContext } from "./agent";
import type { SceneStatus } from "./scene-requests";

/** API 不绑定角色；角色相关接口按请求参数读取已启用的角色身份。 */
export type ExtensionApiContext = {
  getCharacter(characterId: string): ExtensionContext["character"];
  /** 私有部署的用户入口；agentId 为本扩展内声明的 ID。 */
  prepareScene(characterId: string, agentId: string, context?: string): Promise<SceneStatus>;
  getSceneStatus(characterId: string, agentId: string, sessionId: string): Promise<SceneStatus>;
};

/** api.ts 默认导出；create 只装配路由，不创建角色 agent 或启动后台任务。 */
export type ExtensionApiDefinition = {
  access: "public" | "private";
  create(context: ExtensionApiContext): Hono;
};

export type ExtensionApiImport = {
  extension: string;
  load(): Promise<{ default: ExtensionApiDefinition }>;
};
