import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { get_data_dir } from "../paths/data";
import defaults from "./defaults.json" with { type: "json" };
import { type Config, config_schema } from "./schema";

/** 配置通过 { "$env": "变量名" } 显式引用环境变量，缺失或格式错误直接报错。 */
function resolveEnvironmentReferences(
  value: unknown,
  environment: NodeJS.ProcessEnv,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      resolveEnvironmentReferences(item, environment, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const fields = value as Record<string, unknown>;
  if (Object.hasOwn(fields, "$env")) {
    if (Object.keys(fields).length !== 1 || typeof fields.$env !== "string") {
      throw new Error(`${path} 的环境变量引用必须是仅包含字符串 $env 字段的对象`);
    }
    const resolved = environment[fields.$env];
    if (!resolved) {
      throw new Error(`${path} 引用的环境变量 ${fields.$env} 未配置`);
    }
    return resolved;
  }

  return Object.fromEntries(
    Object.entries(fields).map(([key, item]) => [
      key,
      resolveEnvironmentReferences(item, environment, `${path}.${key}`),
    ]),
  );
}

function merge_config(base: unknown, override: unknown): unknown {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== "object" ||
    override === null ||
    Array.isArray(override)
  ) {
    return override;
  }

  const base_fields = base as Record<string, unknown>;
  const override_fields = override as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys({ ...base_fields, ...override_fields }).map((key) => [
      key,
      Object.hasOwn(override_fields, key)
        ? merge_config(base_fields[key], override_fields[key])
        : base_fields[key],
    ]),
  );
}

let configuration: Promise<Config> | undefined;

// 同一进程使用首次加载的配置快照；配置修改通过重启生效。
export function load_config(): Promise<Config> {
  configuration ??= readConfig();
  return configuration;
}

async function readConfig() {
  const data_dir = await get_data_dir();
  const config_dir = join(data_dir, "config");
  // 部署产物已包含目录时只读文件，不向只读文件系统发出创建请求。
  if (!existsSync(config_dir)) {
    await mkdir(config_dir, { recursive: true });
  }

  let user_config: string;
  try {
    user_config = await readFile(join(config_dir, "config.json"), "utf8");
  } catch (error) {
    // 用户配置可以不存在，其他读取错误必须正常暴露。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return config_schema.parse(defaults);
    }
    throw error;
  }

  const resolved = resolveEnvironmentReferences(JSON.parse(user_config), process.env, "配置");
  return config_schema.parse(merge_config(defaults, resolved));
}
