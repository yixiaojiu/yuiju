import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getInteractionDirectory, type InteractionConfig } from "./config.ts";
import { builtInActions } from "./protocol.ts";

const modelSchema = z.object({
  FileReferences: z.object({
    Expressions: z.array(z.object({ Name: z.string().min(1), File: z.string().min(1) })).optional(),
  }),
});

/** 台本标记名 → 模型表情名；API 与场景 agent 从同一份模型声明解析能力。 */
export async function readLive2DExpressions(
  config: InteractionConfig["live2d"],
): Promise<Record<string, string>> {
  const path = join(await getInteractionDirectory(), config.model);
  const model = modelSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const names = (model.FileReferences.Expressions ?? []).map((expression) => expression.Name);
  if (new Set(names).size !== names.length) {
    throw new Error(`Live2D 模型存在重复的表情名称：${config.model}`);
  }

  const aliases = new Map<string, string>();
  for (const [alias, name] of Object.entries(config.expression_aliases ?? {})) {
    if (!names.includes(name)) {
      throw new Error(`Live2D 表情别名 ${alias} 指向不存在的表情：${name}`);
    }
    if (aliases.has(name)) {
      throw new Error(`Live2D 表情 ${name} 配置了多个别名`);
    }
    aliases.set(name, alias);
  }

  const expressions = new Map<string, string>();
  for (const name of names) {
    const tag = aliases.get(name) ?? name;
    if (tag.trim() !== tag || /[【】<>,，\r\n]/.test(tag)) {
      throw new Error(`Live2D 表情名称不能用于台本标记，请配置有效别名：${tag}`);
    }
    if (builtInActions.includes(tag) || expressions.has(tag)) {
      throw new Error(`Live2D 表情名称与动作或其他表情重复：${tag}`);
    }
    expressions.set(tag, name);
  }
  return Object.fromEntries(expressions);
}
