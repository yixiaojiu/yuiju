import { open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { get_data_dir } from "@yuiju/shared/paths/data";
import { Hono } from "hono";
import { getDeployment } from "@/lib/deployment";

const logApps = ["character-runtime", "world-simulator"] as const;
const filePattern = /^app-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/;
export type LogEntry = { timestamp: string; level: string; message: string; details: string };

export const logsApi = new Hono()
  .use("*", async (c, next) => {
    if ((await getDeployment()).publicDeployment) {
      return c.notFound();
    }
    if (!logApps.includes(c.req.query("app") as (typeof logApps)[number])) {
      return c.json({ error: "应用无效" }, 400);
    }
    await next();
  })
  .get("/files", async (c) => {
    const root = resolve(await get_data_dir(), "..", "apps", c.req.query("app")!, "logs");
    const files = (await readdir(root))
      .filter((name) => filePattern.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return c.json({ files });
  })
  .get("/", async (c) => {
    const file = c.req.query("file");
    const offsetParam = c.req.query("offset");
    if (
      !file ||
      !filePattern.test(file) ||
      (offsetParam !== undefined &&
        (!/^\d+$/.test(offsetParam) || !Number.isSafeInteger(Number(offsetParam))))
    ) {
      return c.json({ error: "文件名或日志游标无效" }, 400);
    }
    const path = resolve(await get_data_dir(), "..", "apps", c.req.query("app")!, "logs", file);
    const handle = await open(path, "r");
    try {
      const size = (await handle.stat()).size;
      const tail = offsetParam === undefined && size > 256 * 1024;
      let offset = offsetParam === undefined ? Math.max(0, size - 256 * 1024) : Number(offsetParam);
      if (offset > size) {
        return c.json({ error: "日志文件已变化，请重新加载" }, 409);
      }
      // 初次读取最新 256 KiB，此后只读新增完整行；截断位置不能切开 UTF-8 消息。
      const buffer = Buffer.alloc(Math.min(256 * 1024, size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const newline = buffer.subarray(0, bytesRead).lastIndexOf(10);
      const entries: LogEntry[] = [];
      if (newline >= 0) {
        const start = tail ? buffer.indexOf(10) + 1 : 0;
        for (const line of buffer
          .subarray(start, newline)
          .toString("utf8")
          .split("\n")
          .filter(Boolean)) {
          const { timestamp, level, message, app: _app, ...details } = JSON.parse(line);
          const text = Object.keys(details).length ? JSON.stringify(details, null, 2) : "";
          entries.push({
            timestamp,
            level,
            message,
            details: text.length > 5000 ? `${text.slice(0, 2400)}\n…\n${text.slice(-2400)}` : text,
          });
        }
        offset += newline + 1;
      } else if (bytesRead === 256 * 1024) {
        return c.json({ error: "单条日志超过读取上限" }, 422);
      }
      return c.json({ entries, offset });
    } finally {
      await handle.close();
    }
  });
