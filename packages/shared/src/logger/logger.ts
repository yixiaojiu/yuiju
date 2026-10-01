import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// 应用入口先初始化，业务模块再开始记录日志；导入时不创建输出或文件。
export const logger = winston.createLogger({ transports: [] });

export async function init_logger(options: {
  app: string;
  log_dir: string | URL;
  level: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";
}) {
  const log_dir = options.log_dir instanceof URL ? fileURLToPath(options.log_dir) : options.log_dir;
  await mkdir(log_dir, { recursive: true });

  logger.configure({
    level: options.level,
    defaultMeta: { app: options.app },
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.timestamp(),
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.printf(({ timestamp, level, app, message, stack, ...fields }) => {
          const metadata = Object.keys(fields).length
            ? ` ${inspect(Object.fromEntries(Object.entries(fields)), { depth: null, breakLength: Infinity })}`
            : "";
          return `[${timestamp}] [${level}] [${app}] ${message}${metadata}${stack ? `\n${stack}` : ""}`;
        }),
      }),
      new DailyRotateFile({
        dirname: log_dir,
        filename: "app-%DATE%.log",
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "7d",
        zippedArchive: false,
        format: winston.format.json(),
      }),
    ],
  });
}
