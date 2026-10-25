import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load_config } from "@yuiju/shared/config/load";
import { createLlmAnalytics } from "@yuiju/shared/llm/analytics";
import { flashModel } from "@yuiju/shared/llm/models";
import { createProvider } from "@yuiju/shared/llm/provider";
import { get_data_dir } from "@yuiju/shared/utils/path";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { z } from "zod";

/** 角色单独配置连接入口、Live2D 资源与声音；扩展不绑定某个角色。 */
export const configSchema = z.object({
  connection: z.object({
    url: z
      .url()
      .startsWith("ws://")
      .refine((value) => new URL(value).port !== "", "连接地址必须显式指定端口"),
    token: z.string().min(32),
  }),
  live2d: z.object({
    /** 相对于插件目录，例如 live2d/yuuno/33.model3.json。 */
    model: z.string().min(1),
    /** 台本使用的别名 → model3.json 中的表情 Name；未配置别名时使用原名。 */
    expression_aliases: z.record(z.string().min(1), z.string().min(1)).optional(),
  }),
  asr: z.object({ endpoint: z.url(), api_key: z.string(), model: z.string() }).optional(),
  tts: z.object({
    endpoint: z.url(),
    api_key: z.string(),
    model: z.string(),
    references: z.record(z.string(), z.string()),
    request: z.record(z.string(), z.unknown()),
  }),
});
export type InteractionConfig = z.infer<typeof configSchema>;

const fileSchema = z.object({
  llm: z
    .object({
      base_url: z.url(),
      api_key: z.string().optional(),
      model: z.string().min(1),
      context_window_tokens: z.number().int().positive(),
      headers: z.record(z.string(), z.string()).optional(),
      request: z.record(z.string(), z.json()).optional(),
    })
    .optional(),
  characters: z.record(z.string().min(1), configSchema),
});
let configuration: Promise<z.infer<typeof fileSchema>> | undefined;

/** 插件的配置与模型资源统一归属此目录；资源路径相对此目录解析。 */
export async function getInteractionDirectory(): Promise<string> {
  return join(await get_data_dir(), "extension-config/yuiju-interaction");
}

/** 插件自行维护 config.json；首次使用时读取，修改后重启。 */
async function readConfigFile() {
  const path = join(await getInteractionDirectory(), "config.json");
  return fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** 互动与压缩共用扩展模型；未配置 llm 时使用公共 flash 模型。 */
export async function readInteractionModel(): Promise<{
  model: LanguageModel;
  windowTokens: number;
}> {
  configuration ??= readConfigFile();
  const { llm } = await configuration;
  if (llm === undefined) {
    const windowTokens = (await load_config()).llm?.models?.flash?.context_window_tokens;
    if (windowTokens === undefined) {
      throw new Error("互动场景需要配置 flash.context_window_tokens");
    }
    return { model: flashModel, windowTokens };
  }
  return {
    model: wrapLanguageModel({
      model: createProvider(llm, "yuiju-interaction").chatModel(llm.model),
      middleware: createLlmAnalytics("yuiju-interaction", new URL(llm.base_url).host),
    }),
    windowTokens: llm.context_window_tokens,
  };
}

/** agent 与 API 使用同一份插件配置，不读取主配置中的插件参数。 */
export async function readCharacterConfig(characterId: string): Promise<InteractionConfig> {
  configuration ??= readConfigFile();
  const config = (await configuration).characters[characterId];
  if (!config) {
    throw new Error(`yuiju-interaction 未配置角色：${characterId}`);
  }
  return config;
}
