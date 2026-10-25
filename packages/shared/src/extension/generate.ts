import { cp, glob, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { readConfigFile } from "../config/load";
import { config_schema } from "../config/schema";
import { getProjectRoot } from "../utils/path";

/** 按登记包名优先查找本地扩展，再查已安装包；生成阶段不执行扩展代码。 */
async function main() {
  const root = getProjectRoot();
  const config = z
    .object({ extensions: config_schema.shape.extensions })
    .parse(await readConfigFile());
  const runtimeDirectory = join(root, "apps/character-runtime/src/extensions");
  const dashboardDirectory = join(root, "apps/dashboard/src/extensions");
  const publicDirectory = join(root, "apps/dashboard/public/extensions");
  const projectRequire = createRequire(join(root, "package.json"));

  // 目录名可以与包名不同；只登记配置需要的本地包，不执行其中的代码。
  const localPackages = new Map<string, string>();
  for await (const path of glob("data/extensions/*/package.json", { cwd: root })) {
    const packageJsonPath = join(root, path);
    const localPackage = z
      .object({ name: z.string().min(1) })
      .parse(JSON.parse(await readFile(packageJsonPath, "utf8")));
    if (!config.extensions?.includes(localPackage.name)) {
      continue;
    }
    if (localPackages.has(localPackage.name)) {
      throw new Error(`本地扩展包名重复：${localPackage.name}`);
    }
    localPackages.set(localPackage.name, packageJsonPath);
  }

  const agents: string[] = [];
  const apis: string[] = [];
  const pages: string[] = [];
  const sources: string[] = [];
  const assets: { name: string; directory: string }[] = [];
  for (const name of config.extensions ?? []) {
    const localPackagePath = localPackages.get(name);
    const packageJsonPath = localPackagePath ?? projectRequire.resolve(`${name}/package.json`);
    const packageDirectory = dirname(packageJsonPath);
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (Object.hasOwn(packageJson, "exports")) {
      throw new Error(`扩展 ${name} 不应设置 exports，包内文件需允许直接导入`);
    }

    // 本地包没有安装为依赖，使用相对导入，确保同名 npm 包不会被误加载。
    const runtimePrefix = localPackagePath
      ? `./${relative(runtimeDirectory, packageDirectory).replaceAll("\\", "/")}`
      : name;
    const dashboardPrefix = localPackagePath
      ? `./${relative(dashboardDirectory, packageDirectory).replaceAll("\\", "/")}`
      : name;
    if (await hasConfigFile(join(packageDirectory, "agent.ts"))) {
      agents.push(renderEntry(name, `${runtimePrefix}/agent.ts`));
    }
    if (await hasConfigFile(join(packageDirectory, "api.ts"))) {
      apis.push(renderEntry(name, `${dashboardPrefix}/api.ts`));
    }
    if (await hasConfigFile(join(packageDirectory, "web.ts"))) {
      pages.push(renderEntry(name, `${dashboardPrefix}/web.ts`));
      sources.push(`@source ${JSON.stringify(relative(dashboardDirectory, packageDirectory))};`);
    }
    // 扩展的 public 是可选静态目录；不读取配置、不执行插件入口。
    for await (const path of glob("public", { cwd: packageDirectory })) {
      const directory = join(packageDirectory, path);
      if (!(await stat(directory)).isDirectory()) {
        throw new Error(`扩展 ${name} 的 public 必须是目录`);
      }
      assets.push({ name, directory });
    }
  }

  // 全部包与配置文件检查通过后才写入，生成物不包含完整配置或密钥。
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(dashboardDirectory, { recursive: true });
  await writeFile(join(runtimeDirectory, "generated.ts"), renderTable("extensionAgents", agents));
  await writeFile(join(dashboardDirectory, "generated-api.ts"), renderTable("extensionApis", apis));
  await writeFile(
    join(dashboardDirectory, "generated-pages.ts"),
    renderTable("extensionPages", pages),
  );
  await writeFile(
    join(dashboardDirectory, "generated-sources.css"),
    `/* 由 pnpm run generate:extensions 生成，请勿手改。 */\n${sources.join("\n")}\n`,
  );
  // 整个目录都是生成物；移除未引入扩展的旧资源，避免公开部署残留私有资源。
  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  for (const asset of assets) {
    await cp(asset.directory, join(publicDirectory, asset.name), { recursive: true });
  }
  console.info(
    `扩展导入表已生成：${agents.length} 个 agent 配置，${apis.length} 个 API 配置，${pages.length} 个页面配置，${assets.length} 个静态目录`,
  );
}

/** 三种配置文件均可缺省；其他文件系统错误直接暴露。 */
async function hasConfigFile(path: string) {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error(`扩展配置入口必须是文件：${path}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 明确引用 TS 文件，不依赖扩展名补全或 package.json 的条件导出。 */
function renderEntry(extension: string, specifier: string) {
  return `  { extension: ${JSON.stringify(extension)}, load: () => import(${JSON.stringify(specifier)}) }`;
}

function renderTable(name: string, entries: string[]) {
  return `// 由 pnpm run generate:extensions 生成，请勿手改。\nexport const ${name} = [\n${entries.join(",\n")}\n] as const;\n`;
}

main();
