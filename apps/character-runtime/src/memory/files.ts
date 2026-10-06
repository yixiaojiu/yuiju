import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { get_data_dir } from "@yuiju/shared/paths/data";

/** 文件名来自角色或平台标识；编码点和路径分隔符，保持目录始终位于角色 memory 内。 */
export async function memoryPath(characterId: string, ...parts: string[]): Promise<string> {
  const component = (value: string) => encodeURIComponent(value).replaceAll(".", "%2E");
  return join(await get_data_dir(), "characters", component(characterId), "memory", ...parts);
}

/** 同一角色的每日整理串行写文件；rename 前崩溃仍保留上一份完整正文。 */
export async function writeMemoryFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2));
  await rename(`${path}.tmp`, path);
}
