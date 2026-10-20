import type { Hono } from "hono";
import type { z } from "zod";
import type { ExtensionContext } from "./agent";

/** api.ts 默认导出；create 只装配路由，不创建角色 agent 或启动后台任务。 */
export type ExtensionApiDefinition<Config = unknown> = {
  access: "public" | "private";
  configSchema: z.ZodType<Readonly<Config>>;
  create(context: ExtensionContext<Config>): Hono;
};

export type ExtensionApiImport = {
  extension: string;
  load(): Promise<{ default: ExtensionApiDefinition }>;
};
