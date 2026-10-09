import { logger } from "@yuiju/shared/logger/logger";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { activitiesApi } from "@/api/activities";
import { charactersApi } from "@/api/characters";
import { logsApi } from "@/api/logs";
import { memoriesApi } from "@/api/memories";
import { worldApi } from "@/api/world";

export const runtime = "nodejs";

const app = new Hono().basePath("/api");

app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
app.onError((error, c) => {
  logger.error("Dashboard 查询失败", { path: c.req.path, error });
  return c.json({ error: "读取失败，请检查服务日志" }, 500);
});
app.route("/character", charactersApi);
app.route("/activities", activitiesApi);
app.route("/memories", memoriesApi);
app.route("/logs", logsApi);
app.route("/world", worldApi);

app.get("/health", (context) => context.json({ ok: true }));

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
