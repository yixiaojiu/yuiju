import {
  countRecentMemoryEpisodes,
  getRecentMemoryEpisodes,
  isDev,
  type MemoryEpisodeType,
  type MongoReadSource,
  SUBJECT_NAME,
} from "@yuiju/utils";
import { type ActivityItem, mapEpisodeToActivityItem } from "./activity-view";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export const ACTIVITY_TYPES = [
  "behavior",
  "conversation",
  "plan_created",
  "plan_updated",
  "plan_completed",
  "plan_abandoned",
  "system",
] as const satisfies readonly MemoryEpisodeType[];

export type ActivityTriggerFilter = "all" | "agent" | "user" | "system";
export type ActivityEpisodeTypeFilter = "all" | (typeof ACTIVITY_TYPES)[number];

export interface QueryActivityEventsOptions {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  trigger?: ActivityTriggerFilter;
  episodeType?: ActivityEpisodeTypeFilter;
  keyword?: string;
  readFrom?: MongoReadSource;
}

export interface ActivityPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
}

export interface QueryActivityEventsResult {
  events: ActivityItem[];
  pagination: ActivityPagination;
}

export function normalizeActivityPage(page: number | undefined): number {
  if (!Number.isFinite(page)) return DEFAULT_PAGE;
  if (!page || page <= 0) return DEFAULT_PAGE;
  return Math.floor(page);
}

export function normalizeActivityPageSize(pageSize: number | undefined): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  if (!pageSize || pageSize <= 0) return DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return Math.floor(pageSize);
}

export async function queryActivityEvents(
  options?: QueryActivityEventsOptions,
): Promise<QueryActivityEventsResult> {
  const requestedPage = normalizeActivityPage(options?.page);
  const pageSize = normalizeActivityPageSize(options?.pageSize);

  try {
    const queryOptions = {
      types: [...ACTIVITY_TYPES],
      subject: SUBJECT_NAME,
      isDev: isDev(),
      sortField: "createdAt" as const,
      readFrom: options?.readFrom,
      keyword: options?.keyword?.trim() || undefined,
      ...resolveDateRange(options?.startDate, options?.endDate),
      ...resolveTriggerFilter(options?.trigger ?? "all"),
    };

    if (options?.episodeType && options.episodeType !== "all") {
      queryOptions.types = [options.episodeType];
    }

    const total = await countRecentMemoryEpisodes(queryOptions);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * pageSize;

    const docs = await getRecentMemoryEpisodes({
      ...queryOptions,
      limit: pageSize,
      skip,
    });

    const events = docs.map((item) => mapEpisodeToActivityItem(item));

    return {
      events,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  } catch (error) {
    console.error("queryActivityEvents failed:", error);
    return {
      events: [],
      pagination: {
        page: requestedPage,
        pageSize,
        total: 0,
        totalPages: 1,
        hasPrevPage: false,
        hasNextPage: false,
      },
    };
  }
}

function resolveDateRange(
  startDate: string | undefined,
  endDate: string | undefined,
): { happenedAfter?: Date; happenedBefore?: Date } {
  const happenedAfter = parseDateParam(startDate, "start");
  const happenedBefore = parseDateParam(endDate, "end");
  return {
    happenedAfter,
    happenedBefore,
  };
}

function parseDateParam(value: string | undefined, boundary: "start" | "end"): Date | undefined {
  if (!value) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  if (boundary === "end") {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

function resolveTriggerFilter(trigger: ActivityTriggerFilter) {
  if (trigger === "user") {
    return { sources: ["chat" as const] };
  }
  if (trigger === "system") {
    return {
      sourceOrTypes: {
        sources: ["system" as const],
        types: ["system" as const],
      },
    };
  }
  if (trigger === "agent") {
    return {
      excludeSources: ["chat" as const, "system" as const],
      excludeTypes: ["system" as const],
    };
  }
  return {};
}
