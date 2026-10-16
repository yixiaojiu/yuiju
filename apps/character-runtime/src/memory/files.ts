import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { get_data_dir } from "@yuiju/shared/paths/data";

/** 文件名来自角色或平台标识；编码点和路径分隔符，保持目录始终位于角色 memory 内。 */
export async function memoryPath(characterId: string, ...parts: string[]): Promise<string> {
  const component = (value: string) => encodeURIComponent(value).replaceAll(".", "%2E");
  return join(await get_data_dir(), "characters", component(characterId), "memory", ...parts);
}

/** 调用方负责串行化同一文件的读改写；rename 前崩溃仍保留上一份完整正文。 */
export async function writeMemoryFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2));
  await rename(`${path}.tmp`, path);
}

const fileWriters = new Map<string, Promise<void>>();

/** 串行化同一记忆文件的读改写；调用方必须在 finally 中释放，不跨文件阻塞。 */
export async function lockMemoryFile(path: string): Promise<() => void> {
  const previous = fileWriters.get(path);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  fileWriters.set(path, current);
  await previous;
  return () => {
    release();
    if (fileWriters.get(path) === current) {
      fileWriters.delete(path);
    }
  };
}
