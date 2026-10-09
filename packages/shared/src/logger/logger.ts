import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// 应用入口先初始化，业务模块再开始记录日志；导入时不创建输出或文件。
export const logger = winston.createLogger({ transports: [] });

/** 不传 log_dir 时仅输出到控制台，不创建日志目录或文件。 */
export async function init_logger(options: {
  app: string;
  log_dir?: string | URL;
  level: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";
}) {
  const logDir = options.log_dir instanceof URL ? fileURLToPath(options.log_dir) : options.log_dir;
  if (logDir !== undefined) {
    await mkdir(logDir, { recursive: true });
  }

  logger.configure({
    level: options.level,
    defaultMeta: { app: options.app },
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.timestamp(),
      // 两种输出共用字段限制；大对象转为可读文本，小对象仍保留结构。
      winston.format((entry) => {
        for (const [key, value] of Object.entries(entry)) {
          const text =
            typeof value === "string"
              ? value
              : value !== null && typeof value === "object"
                ? inspect(value, { depth: null, breakLength: Infinity })
                : undefined;
          if (value instanceof Error) {
            entry[key] = text;
          }
          if (text === undefined || text.length <= 1000) {
            continue;
          }
          const marker = `…（省略 ${text.length - 900} 字符）…`;
          entry[key] = `${text.slice(0, 450)}${marker}${text.slice(-450)}`;
        }
        return entry;
      })(),
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
    ],
  });
  if (logDir !== undefined) {
    logger.add(
      new DailyRotateFile({
        dirname: logDir,
        filename: "app-%DATE%.log",
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "7d",
        zippedArchive: false,
        format: winston.format.json(),
      }),
    );
  }
}
