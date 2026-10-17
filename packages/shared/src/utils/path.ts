import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 从工作目录向上定位 pnpm 工作区根目录，不依赖源码位置，也不创建目录。 */
export function getProjectRoot() {
  let root = process.cwd();
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const parent = dirname(root);
    if (parent === root) {
      throw new Error("无法定位 pnpm 工作区根目录");
    }
    root = parent;
  }
  return root;
}

/** 获取项目根目录下的 data 目录，不存在时创建。 */
export async function get_data_dir() {
  const dataDir = join(getProjectRoot(), "data");
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  return dataDir;
}
