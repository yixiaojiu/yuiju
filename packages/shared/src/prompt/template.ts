export type PromptTemplate = {
  key: string;
  description?: string;
  template: string;
};

const prompts = new Map<string, PromptTemplate>();
let initialization: Promise<void> | undefined;

function registerPrompts(definitions: readonly PromptTemplate[]): void {
  for (const definition of definitions) {
    if (prompts.has(definition.key)) {
      throw new Error(`提示词重复注册：${definition.key}`);
    }
    prompts.set(definition.key, definition);
  }
}

// 保持异步调用契约，后续在渲染前按 key 读取数据库中的覆盖模板。
export async function renderPrompt(
  key: string,
  variables: Record<string, string> = {},
): Promise<string> {
  initialization ??= import("./definitions").then(({ promptDefinitions }) => {
    registerPrompts(promptDefinitions);
  });
  await initialization;

  const prompt = prompts.get(key);
  if (!prompt) {
    throw new Error(`提示词未注册：${key}`);
  }

  return prompt.template.replace(/\{\{\s*([a-zA-Z_$][\w$]*)\s*\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(variables, name)) {
      throw new Error(`提示词 ${key} 缺少变量：${name}`);
    }
    return variables[name];
  });
}
