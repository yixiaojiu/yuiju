import { mkdir, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { logger } from "../logger/logger";
import { get_data_dir } from "../utils/path";
import { promptDefinitions } from "./definitions";

export type PromptTemplate = {
  key: string;
  description?: string;
  template: string;
};

let prompts = new Map<string, PromptTemplate>();

/** 启动时加载默认模板；data/prompt 中的 .txt、.md 文件去掉扩展名后覆盖或新增 key。 */
export async function initializePrompts(): Promise<void> {
  const loaded = new Map<string, PromptTemplate>();
  for (const definition of promptDefinitions) {
    if (loaded.has(definition.key)) {
      throw new Error(`提示词重复注册：${definition.key}`);
    }
    loaded.set(definition.key, definition);
  }

  const directory = join(await get_data_dir(), "prompt");
  await mkdir(directory, { recursive: true });
  const filesByKey = new Map<string, string>();
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const extension = extname(file.name);
    if (!file.isFile() || (extension !== ".txt" && extension !== ".md")) {
      continue;
    }
    const key = file.name.slice(0, -extension.length);
    if (filesByKey.has(key)) {
      throw new Error(`提示词文件 key 重复：${filesByKey.get(key)} 与 ${file.name}`);
    }
    filesByKey.set(key, file.name);
    const template = await readFile(join(directory, file.name), "utf8");
    loaded.set(key, { ...loaded.get(key), key, template });
  }
  prompts = loaded;
}

/** 渲染内存模板；未注册的 key 警告并返回空字符串，未传入的变量保留原始占位符。 */
export async function renderPrompt(
  key: string,
  variables: Record<string, string> = {},
): Promise<string> {
  const prompt = prompts.get(key);
  if (!prompt) {
    logger.warn("提示词未注册，返回空内容", { key });
    return "";
  }

  return prompt.template.replace(
    /\{\{\s*([a-zA-Z_$][\w$]*)\s*\}\}/g,
    (placeholder, name: string) => {
      if (!Object.hasOwn(variables, name)) {
        return placeholder;
      }
      return variables[name];
    },
  );
}
