import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { evaluationReporter } from "./report";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(
  root,
  "evals/output",
  `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
mkdirSync(outputDir, { recursive: true });
const revision = `${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim()}${execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() ? "（有未提交改动）" : ""}`;

export default defineConfig({
  root,
  test: {
    include: ["evals/**/*.eval.ts"],
    setupFiles: ["./evals/fixtures.ts"],
    env: { NODE_ENV: "development" },
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 100_000,
    provide: { evalOutputDir: outputDir },
    reporters: ["verbose", evaluationReporter(outputDir, revision)],
  },
});
