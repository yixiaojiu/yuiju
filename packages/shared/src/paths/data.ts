import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 从工作目录定位 pnpm 工作区；不依赖源码位置，Next.js 打包后仍使用仓库根目录的 data。 */
export async function get_data_dir() {
  let root = process.cwd();
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const parent = dirname(root);
    if (parent === root) {
      throw new Error("无法定位 pnpm 工作区根目录");
    }
    root = parent;
  }
  const dataDir = join(root, "data");
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  return dataDir;
}
