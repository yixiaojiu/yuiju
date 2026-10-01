import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { get_data_dir } from "../paths/data";
import { type Config, config_schema } from "./schema";

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
  const defaults = JSON.parse(await readFile(new URL("./defaults.json", import.meta.url), "utf8"));
  const data_dir = await get_data_dir();
  const config_dir = join(data_dir, "config");
  await mkdir(config_dir, { recursive: true });

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

  return config_schema.parse(merge_config(defaults, JSON.parse(user_config)));
}
