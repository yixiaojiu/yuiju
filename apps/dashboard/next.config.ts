import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(currentDir, "../.."),
  outputFileTracingIncludes: {
    // 运行时通过工作区标记定位 data，配置内的 $env 仍在服务端解析。
    "/*": ["../../pnpm-workspace.yaml", "../../data/config/config.json"],
  },
};

export default nextConfig;
