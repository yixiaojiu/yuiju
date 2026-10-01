import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, expect, it } from "vitest";
import winston from "winston";
import { init_logger, logger } from "./logger";

it("共享实例输出控制台文本与 JSON 文件，保留业务字段和错误堆栈", async () => {
  const temp_dir = await mkdtemp(join(tmpdir(), "yuiju-logger-"));
  const log_dir = join(temp_dir, "app", "logs");
  try {
    expect(logger.transports).toHaveLength(0);
    await init_logger({ app: "test-app", level: "info", log_dir: pathToFileURL(log_dir) });
    const console_transport = logger.transports.find(
      (transport) => transport instanceof winston.transports.Console,
    )!;
    console_transport.silent = true;
    const formatted = console_transport.format!.transform({
      timestamp: "2026-09-28T12:00:00.000Z",
      level: "info",
      app: "test-app",
      message: "收到事件",
      event_type: "action_completed",
    });
    assert(typeof formatted === "object");
    expect(formatted[Symbol.for("message")]).toContain("[info] [test-app] 收到事件");
    expect(formatted[Symbol.for("message")]).toContain("action_completed");

    const error = new Error("连接中断");
    logger.debug("不应写入");
    logger.info("收到事件", { event_type: "action_completed" });
    logger.error("连接失败", error);
    logger.error(new Error("直接记录异常"));
    const finished = once(logger, "finish");
    logger.end();
    await finished;

    const files = (await readdir(log_dir)).filter((file) => file.endsWith(".log"));
    expect(files).toHaveLength(1);
    const records = (await readFile(join(log_dir, files[0]), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      app: "test-app",
      level: "info",
      message: "收到事件",
      event_type: "action_completed",
    });
    expect(Number.isNaN(Date.parse(records[0].timestamp))).toBe(false);
    expect(records[1].message).toContain("连接失败");
    expect(records[1].stack).toBe(error.stack);
    expect(records[2].stack).toContain("Error: 直接记录异常");
  } finally {
    logger.close();
    await rm(temp_dir, { recursive: true, force: true });
  }
});
