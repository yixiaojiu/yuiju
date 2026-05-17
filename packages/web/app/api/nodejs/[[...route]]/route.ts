import { Hono } from "hono";
import { handle } from "hono/vercel";
import { activityRoute } from "./activity";
import { diaryRoute } from "./diary";
import { filesRoute } from "./files";
import { homeRoute } from "./home";
import { logsRoute } from "./logs";
import { stateRoute } from "./state";

export const runtime = "nodejs";

const app = new Hono().basePath("/api/nodejs");

app.get("/hello", async (context) => {
  return context.json({ hello: "world" });
});

app.route("/home", homeRoute);
app.route("/activity", activityRoute);
app.route("/diary", diaryRoute);
app.route("/state", stateRoute);
app.route("/logs", logsRoute);
app.route("/files", filesRoute);

// 全局错误处理
app.onError((err, context) => {
  context.status(500);
  console.error(err);

  return context.json({
    code: 500,
    data: null,
    message: err.message,
  });
});

export const GET = handle(app);
export const POST = handle(app);
