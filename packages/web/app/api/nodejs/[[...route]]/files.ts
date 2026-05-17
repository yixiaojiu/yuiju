import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { getYuijuConfig, getYuijuProjectRoot } from "@yuiju/utils";
import { Hono } from "hono";
import { rejectPublicRequest } from "./public-guard";

type FileScope = "logs" | "memory";
type LogsService = "world" | "message";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

const LOGS_SERVICES: LogsService[] = ["message", "world"];

const resolveScopeRoot = (scope: FileScope, logsService: LogsService) => {
  const repoRoot = getYuijuProjectRoot();
  if (scope === "logs") {
    return resolve(repoRoot, `packages/${logsService}/logs`);
  }

  return resolve(repoRoot, getYuijuConfig().app.memoryDir);
};

const normalizeRelPath = (value: string | undefined) => {
  if (!value) return "";
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
};

const assertPathInRoot = (rootDir: string, relPath: string) => {
  const absolutePath = resolve(rootDir, relPath);
  const rel = relative(rootDir, absolutePath);

  if (rel.startsWith("..") || rel.includes("../") || rel === "..") {
    throw new Error("illegal_path");
  }

  return absolutePath;
};

const sortNodes = (nodes: FileTreeNode[]) => {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
};

const buildTree = async (rootDir: string, currentDirPath: string): Promise<FileTreeNode[]> => {
  const entries = await readdir(currentDirPath, { withFileTypes: true, encoding: "utf8" }).catch(
    () => null,
  );
  if (!entries) {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absPath = resolve(currentDirPath, entry.name);
    const relPath = relative(rootDir, absPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      const children = await buildTree(rootDir, absPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children: sortNodes(children),
      });
      continue;
    }

    if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "file",
      });
    }
  }

  return sortNodes(nodes);
};

const guessLanguage = (filePath: string) => {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md") return "markdown";
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "typescript";
  if (ext === ".js") return "javascript";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".log") return "log";
  if (ext === ".txt") return "plaintext";
  return "plaintext";
};

export const filesRoute = new Hono();

filesRoute.use("*", async (context, next) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }
  await next();
});

filesRoute.get("/tree", async (context) => {
  const scope: FileScope = context.req.query("scope") === "memory" ? "memory" : "logs";
  const logsService: LogsService = context.req.query("service") === "world" ? "world" : "message";
  const rootDir = resolveScopeRoot(scope, logsService);

  const tree = await buildTree(rootDir, rootDir);

  return context.json({
    code: 0,
    data: {
      scope,
      service: logsService,
      services: LOGS_SERVICES,
      tree,
    },
    message: "ok",
  });
});

filesRoute.get("/content", async (context) => {
  const scope: FileScope = context.req.query("scope") === "memory" ? "memory" : "logs";
  const logsService: LogsService = context.req.query("service") === "world" ? "world" : "message";
  const relPath = normalizeRelPath(context.req.query("path"));

  if (!relPath) {
    return context.json({ code: 400, data: null, message: "path is required" }, 400);
  }

  const rootDir = resolveScopeRoot(scope, logsService);

  let absPath = "";
  try {
    absPath = assertPathInRoot(rootDir, relPath);
  } catch {
    return context.json({ code: 400, data: null, message: "invalid path" }, 400);
  }

  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) {
      return context.json({ code: 400, data: null, message: "path is not a file" }, 400);
    }

    const content = await readFile(absPath, "utf8");
    return context.json({
      code: 0,
      data: {
        path: relPath,
        content,
        language: guessLanguage(relPath),
      },
      message: "ok",
    });
  } catch {
    return context.json({ code: 404, data: null, message: "file not found" }, 404);
  }
});

filesRoute.post("/content", async (context) => {
  const payload = await context.req.json<{
    scope?: string;
    service?: string;
    path?: string;
    content?: string;
  }>();

  const scope: FileScope = payload.scope === "memory" ? "memory" : "logs";
  if (scope !== "memory") {
    return context.json({ code: 403, data: null, message: "logs is read-only" }, 403);
  }

  const relPath = normalizeRelPath(payload.path);
  if (!relPath) {
    return context.json({ code: 400, data: null, message: "path is required" }, 400);
  }

  const logsService: LogsService = payload.service === "world" ? "world" : "message";
  const rootDir = resolveScopeRoot(scope, logsService);

  let absPath = "";
  try {
    absPath = assertPathInRoot(rootDir, relPath);
  } catch {
    return context.json({ code: 400, data: null, message: "invalid path" }, 400);
  }

  try {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, payload.content ?? "", "utf8");

    return context.json({
      code: 0,
      data: { path: relPath, bytes: Buffer.byteLength(payload.content ?? "", "utf8") },
      message: "saved",
    });
  } catch (error) {
    return context.json({ code: 500, data: null, message: (error as Error).message }, 500);
  }
});
