/**
 * Winston logger configuration for @yuiju/action (TypeScript ESM)
 * - Supports levels: error, warn, info, debug
 * - Output formats: json | text
 * - Daily rotate file transport for app and error logs
 * - Environment overrides via LOG_LEVEL, LOG_FORMAT, LOG_DIR
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');
const format = process.env.LOG_FORMAT || (isProd ? 'json' : 'text');
const logDir = process.env.LOG_DIR || resolve(__dir, 'logs');

export default {
  service: '@yuiju/action',
  env: process.env.NODE_ENV || 'development',
  level,
  format, // 'json' | 'text'
  consoleEnabled: true,
  fileEnabled: true,
  logDir,
  rotation: {
    datePattern: 'YYYY-MM-DD',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    zippedArchive: true,
  },
  redactKeys: ['password', 'token', 'cookie', 'authorization'],
};

