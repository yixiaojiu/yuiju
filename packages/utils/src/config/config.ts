import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import rootConfig from "../../../../yuiju.config";
import type { YuijuConfig } from "./config-schema";

let cachedConfig: Readonly<YuijuConfig> | null = null;
let cachedProjectRoot: string | null = null;

/**
 * 深度冻结配置对象，避免运行时被意外篡改。
 *
 * 说明：
 * - 配置是全局只读输入，不应该被业务代码在运行中修改；
 * - 这里递归冻结对象与数组，确保各子包拿到的是稳定快照。
 */
function deepFreezeConfig<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  for (const key of Reflect.ownKeys(value)) {
    const nestedValue = (value as Record<PropertyKey, unknown>)[key];
    if (nestedValue && typeof nestedValue === "object") {
      deepFreezeConfig(nestedValue);
    }
  }

  return Object.freeze(value);
}

/**
 * 读取项目根目录的统一配置。
 *
 * 说明：
 * - 真实配置源固定为项目根目录的 yuiju.config.ts；
 * - 读取结果会被缓存并深度冻结，供 monorepo 各子包复用。
 */
export function getYuijuConfig(): Readonly<YuijuConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = deepFreezeConfig(rootConfig);
  return cachedConfig;
}

/**
 * 获取项目根目录绝对路径。
 *
 * 说明：
 * - 配置中的静态资源路径以项目根目录为基准；
 * - 这里基于 utils 包内文件位置推导根目录，避免依赖进程启动 cwd。
 */
export function getYuijuProjectRoot(): string {
  if (cachedProjectRoot) {
    return cachedProjectRoot;
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  cachedProjectRoot = resolve(currentDir, "../../../../");
  return cachedProjectRoot;
}

export type { YuijuConfig } from "./config-schema";
export {
  defineYuijuConfig,
  type YuijuAppConfig,
  type YuijuDatabaseConfig,
  type YuijuLlmConfig,
  type YuijuLlmModelConfig,
  type YuijuLlmModelSourcesConfig,
  type YuijuLlmModelsConfig,
  type YuijuMessageConfig,
  type YuijuMessageInternalApiConfig,
  type YuijuNapcatConfig,
  type YuijuNapcatReconnectionConfig,
  type YuijuStickerConfig,
  type YuijuStickerMap,
} from "./config-schema";
