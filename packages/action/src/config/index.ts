import type { Config, SchoolWindow } from '@/types';

export const defaultSchoolWindow: SchoolWindow = { startMinutes: 7 * 60 + 20, endMinutes: 7 * 60 + 40 };

export const defaultConfig: Config = {
  timezoneOffsetHours: 8,
  schoolWindow: defaultSchoolWindow,
  rateLimitPerMinutes: 1,
  cooldownMs: 180000,
};

