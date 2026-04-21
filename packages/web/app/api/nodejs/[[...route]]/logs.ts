import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";
import { Hono } from "hono";
import { rejectPublicRequest } from "./public-guard";

type LogService = "all" | "world" | "message";
type LogLevel = "debug" | "info" | "warn" | "error";

type ParsedLogLine = {
  timestampMs: number;
  timestampText: string;
  level: string;
  body: string;
};

const LOG_FILENAME_PATTERN = /^(app|error)-\d{4}-\d{2}-\d{2}\.log$/;
const LOG_LINE_PATTERN = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s*(.*)$/;
const ALLOWED_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_FILES_PER_SERVICE = 8;

const currentDir = dirname(fileURLToPath(import.meta.url));

const normalizeService = (value: string | undefined): LogService => {
  if (value === "world" || value === "message") {
    return value;
  }
  return "all";
};

const normalizeLevel = (value: string | undefined): LogLevel | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (ALLOWED_LEVELS.has(normalized as LogLevel)) {
    return normalized as LogLevel;
  }
  return undefined;
};

const normalizeLimit = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
};

const parseDateStartMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return undefined;
  return parsed.startOf("day").valueOf();
};

const parseDateEndExclusiveMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return undefined;
  return parsed.add(1, "day").startOf("day").valueOf();
};

const parseLogLine = (line: string): ParsedLogLine | null => {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const timestampText = match[1] || "";
  const level = (match[2] || "unknown").toLowerCase();
  const body = match[3] || "";

  const timestamp = dayjs(timestampText);
  const timestampMs = timestamp.isValid() ? timestamp.valueOf() : Number.NaN;

  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return {
    timestampMs,
    timestampText,
    level,
    body,
  };
};

const includesKeyword = (line: string, keyword: string | undefined) => {
  if (!keyword) return true;
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return true;
  return line.toLowerCase().includes(normalizedKeyword.toLowerCase());
};

const detectRepoRoot = async () => {
  const candidates = [
    resolve(process.cwd()),
    resolve(process.cwd(), "../.."),
    resolve(currentDir, "../../../../../../"),
  ];

  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, "pnpm-workspace.yaml"));
      return candidate;
    } catch {
      continue;
    }
  }

  return resolve(currentDir, "../../../../../../");
};

const listLogFiles = async (dirPath: string) => {
  try {
    const names = await readdir(dirPath);
    return names
      .filter((name) => LOG_FILENAME_PATTERN.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_FILES_PER_SERVICE)
      .map((name) => resolve(dirPath, name));
  } catch {
    return [] as string[];
  }
};

type SearchFilters = {
  level?: LogLevel;
  keyword?: string;
  startDateMs?: number;
  endDateExclusiveMs?: number;
};

type LogSearchItem = {
  tsNs: string;
  service: string;
  level: string;
  time: string;
  line: string;
  message: string;
};

const matchesFilters = (line: string, parsed: ParsedLogLine, filters: SearchFilters) => {
  if (filters.level && parsed.level !== filters.level) {
    return false;
  }
  if (!includesKeyword(line, filters.keyword)) {
    return false;
  }
  if (typeof filters.startDateMs === "number" && parsed.timestampMs < filters.startDateMs) {
    return false;
  }
  if (
    typeof filters.endDateExclusiveMs === "number" &&
    parsed.timestampMs >= filters.endDateExclusiveMs
  ) {
    return false;
  }

  return true;
};

const collectItemsFromFile = async (
  filePath: string,
  serviceName: Exclude<LogService, "all">,
  filters: SearchFilters,
) => {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return [] as LogSearchItem[];
  }

  const lines = content.split(/\r?\n/);
  const result: LogSearchItem[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const parsed = parseLogLine(line);
    if (!parsed) continue;
    if (!matchesFilters(line, parsed, filters)) continue;

    result.push({
      tsNs: `${parsed.timestampMs}000000`,
      service: serviceName,
      level: parsed.level,
      time: dayjs(parsed.timestampMs).format("YYYY-MM-DD HH:mm:ss"),
      line,
      message: parsed.body,
    });
  }

  return result;
};

const dedupeAndSortItems = (items: LogSearchItem[], limit: number) => {
  const deduped = new Map<string, LogSearchItem>();
  for (const item of items) {
    deduped.set(`${item.service}|${item.tsNs}|${item.line}`, item);
  }

  return [...deduped.values()]
    .sort((a, b) => b.tsNs.localeCompare(a.tsNs))
    .slice(0, limit);
};

const enforceServiceFilter = (items: LogSearchItem[], service: LogService) => {
  if (service === "all") {
    return items;
  }

  return items.filter((item) => {
    return item.service === service;
  });
};

export const logsRoute = new Hono();

logsRoute.use("*", async (context, next) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }
  await next();
});

logsRoute.get("/search", async (context) => {
  const service = normalizeService(context.req.query("service"));
  const level = normalizeLevel(context.req.query("level"));
  const keyword = context.req.query("keyword")?.trim();
  const startDateMs = parseDateStartMs(context.req.query("startDate"));
  const endDateExclusiveMs = parseDateEndExclusiveMs(context.req.query("endDate"));
  const limit = normalizeLimit(context.req.query("limit"));
  const filters: SearchFilters = {
    level,
    keyword,
    startDateMs,
    endDateExclusiveMs,
  };

  const repoRoot = await detectRepoRoot();
  const targetServices: Array<Exclude<LogService, "all">> =
    service === "all" ? ["world", "message"] : [service];

  const serviceFilesMap = await Promise.all(
    targetServices.map(async (serviceName) => {
      const files = await listLogFiles(resolve(repoRoot, `packages/${serviceName}/logs`));
      return [serviceName, files] as const;
    }),
  );

  const items: LogSearchItem[] = [];

  for (const [serviceName, files] of serviceFilesMap) {
    for (const filePath of files) {
      const fileItems = await collectItemsFromFile(filePath, serviceName, filters);
      items.push(...fileItems);
    }
  }

  const sorted = dedupeAndSortItems(items, limit);
  const finalItems = enforceServiceFilter(sorted, service);

  return context.json({
    code: 0,
    data: {
      items: finalItems,
      query: {
        service,
        keyword: keyword || "",
        level: level || "",
        startDate: context.req.query("startDate") || "",
        endDate: context.req.query("endDate") || "",
        limit,
      },
      total: finalItems.length,
    },
    message: "ok",
  });
});
