import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

/** 凭据类字段名按最后一段判断，避免误伤 context_window_tokens 这类计数指标。 */
const credentialFields = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "authorization",
  "cookie",
  "credential",
  "credentials",
]);
/** key 单独出现时语义过宽（提示词也用 key 作标识），只认带限定前缀的形式。 */
const credentialKeyFields = /^(?:api|access|secret|private|signing|session|encryption)[_-]?keys?$/;

function isCredentialField(field: string): boolean {
  const normalized = field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (credentialKeyFields.test(normalized)) {
    return true;
  }
  return credentialFields.has(normalized.split(/[_-]/).pop()!);
}

/** 擦除字符串值内嵌的凭据：URI 的 userinfo 段与 Bearer 令牌。 */
function scrubCredentials(text: string): string {
  return text
    .replace(/(\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[已脱敏]@")
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [已脱敏]");
}

/** 深度脱敏：命中凭据字段名的值整体替换，字符串值擦除内嵌凭据，Error 交给 inspect 后擦除。 */
function redactSecret(value: unknown, field?: string): unknown {
  if (field !== undefined && isCredentialField(field)) {
    return "[已脱敏]";
  }
  if (typeof value === "string") {
    return scrubCredentials(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecret(item));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Error)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecret(item, key)]),
    );
  }
  return value;
}

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
          const redacted = redactSecret(value, key);
          if (redacted !== value) {
            entry[key] = redacted;
          }
          const current = entry[key];
          const text =
            typeof current === "string"
              ? current
              : current !== null && typeof current === "object"
                ? scrubCredentials(inspect(current, { depth: null, breakLength: Infinity }))
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
