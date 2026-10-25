import type { Config } from "@yuiju/shared/config/schema";
import type {
  AgentDefinition,
  ExtensionContext,
  ExtensionImport,
} from "@yuiju/shared/extension/agent";
import type { PromptTemplate } from "@yuiju/shared/prompt/template";

export type LoadedAgent = {
  definition: AgentDefinition;
  context: ExtensionContext;
};
export type LoadedExtensions = {
  agents: Map<string, LoadedAgent>;
  prompts: PromptTemplate[];
};

/** 按启用配置绑定角色身份；提示词初始化完成前不调用任何 create 工厂。 */
export async function loadExtensions(
  character: { id: string; name: string },
  configuration: NonNullable<Config["characters"]>[string]["extensions"],
  imports: readonly ExtensionImport[],
): Promise<LoadedExtensions> {
  const agents = new Map<string, LoadedAgent>();
  const prompts: PromptTemplate[] = [];
  for (const entry of imports) {
    const settings = configuration?.[entry.extension];
    if (!settings?.enabled) {
      continue;
    }
    const { default: extension } = await entry.load();
    const context: ExtensionContext = {
      character: { id: character.id, name: character.name },
    };
    for (const definition of extension.agents) {
      if (!definition.id || definition.id.includes("/")) {
        throw new Error(`扩展 ${entry.extension} 的 agent id 必须非空且不能包含 /`);
      }
      const id = `${entry.extension}/${definition.id}`;
      if (agents.has(id)) {
        throw new Error(`扩展 agent 重复：${id}`);
      }
      agents.set(id, { definition, context });
    }
    prompts.push(...(extension.prompts ?? []));
  }
  return { agents, prompts };
}
