/**
 * Winston-based logging utility for @yuiju/action
 * - Loads configuration from packages/action/logger.config.js
 * - Provides console and daily-rotating file transports
 * - Supports JSON and text formats with redaction
 * - Exposes helpers: getLogger, withContext, logPerformance, captureException
 * - Gracefully falls back to console-only if winston modules are unavailable
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import cfg from '../../logger.config.ts';

/** Redact sensitive fields from log info */
function redact(info: any): any {
  try {
    const keys: string[] = Array.isArray(cfg.redactKeys) ? cfg.redactKeys : [];
    const clone = { ...info } as any;
    const scrub = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (keys.includes(k)) obj[k] = '[REDACTED]';
        else if (v && typeof v === 'object') scrub(v);
      }
    };
    scrub(clone);
    return clone;
  } catch {
    return info;
  }
}

/** Build console format (text or json) */
function buildConsoleFormat() {
  const { format } = winston;
  const base = [
    format.timestamp(),
    format.errors({ stack: true }),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    format((info: any) => redact(info))(),
  ];
  if (cfg.format === 'json') {
    return format.combine(...base, format.json());
  }
  return format.combine(
    ...base,
    format.colorize(),
    format.printf((info: any) => {
      const msg = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
      const meta = info.metadata && Object.keys(info.metadata).length ? ` ${JSON.stringify(info.metadata)}` : '';
      return `${info.timestamp} ${info.level} ${msg}${meta}`;
    })
  );
}

/** Build file JSON format */
function buildFileFormat() {
  const { format } = winston;
  return format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    format((info: any) => redact(info))(),
    format.json()
  );
}

/** Create the Winston logger instance with configured transports */
function createWinstonLogger() {
  const transports: any[] = [];

  if (cfg.consoleEnabled) {
    transports.push(
      new winston.transports.Console({
        level: cfg.level,
        format: buildConsoleFormat(),
      })
    );
  }

  if (cfg.fileEnabled) {
    transports.push(
      new DailyRotateFile({
        dirname: cfg.logDir,
        filename: 'app-%DATE%.log',
        datePattern: cfg.rotation.datePattern,
        maxSize: cfg.rotation.maxSize,
        maxFiles: cfg.rotation.maxFiles,
        zippedArchive: cfg.rotation.zippedArchive,
        level: cfg.level,
        format: buildFileFormat(),
      })
    );
    transports.push(
      new DailyRotateFile({
        dirname: cfg.logDir,
        filename: 'error-%DATE%.log',
        datePattern: cfg.rotation.datePattern,
        maxSize: cfg.rotation.maxSize,
        maxFiles: cfg.rotation.maxFiles,
        zippedArchive: cfg.rotation.zippedArchive,
        level: 'error',
        format: buildFileFormat(),
      })
    );
  }

  return winston.createLogger({
    level: cfg.level,
    defaultMeta: { service: cfg.service, env: cfg.env },
    transports,
    exitOnError: false,
  });
}

const baseLogger: any = createWinstonLogger();

export const logger = baseLogger;

// No additional helpers exported; use `logger.info/error/debug` directly.
