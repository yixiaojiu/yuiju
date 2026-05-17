import {
  countMemoryDiaries,
  DEFAULT_DIARY_SUBJECT,
  getMemoryDiaries,
  getYuijuConfig,
  type IMemoryDiary,
  isDev,
  type MongoReadSource,
} from "@yuiju/utils";
import dayjs from "dayjs";
import { Hono } from "hono";
import { rejectPublicRequest } from "./public-guard";

export const diaryRoute = new Hono();

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

interface DiaryQueryParams {
  page: number;
  pageSize: number;
  startDate?: Date;
  endDateExclusive?: Date;
  startDateText?: string;
  endDateText?: string;
}

const parsePositiveInt = (value: string | undefined, fallback: number, max?: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
};

const parseDateInput = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return undefined;
  return parsed.startOf("day").toDate();
};

/**
 * 解析 diary 列表查询参数。
 *
 * 说明：
 * - 结束日期会被转换成“次日零点”的排他上界，和底层 schema 的 lt 语义保持一致；
 * - 当用户误填开始晚于结束时，自动交换，避免页面直接落成空列表。
 */
const parseDiaryQueryParams = (request: Request): DiaryQueryParams => {
  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get("page") ?? undefined, DEFAULT_PAGE);
  const pageSize = parsePositiveInt(
    url.searchParams.get("pageSize") ?? undefined,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );

  let startDate = parseDateInput(url.searchParams.get("startDate") ?? undefined);
  let endDate = parseDateInput(url.searchParams.get("endDate") ?? undefined);

  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  return {
    page,
    pageSize,
    startDate,
    endDateExclusive: endDate ? dayjs(endDate).add(1, "day").toDate() : undefined,
    startDateText: startDate ? dayjs(startDate).format("YYYY-MM-DD") : undefined,
    endDateText: endDate ? dayjs(endDate).format("YYYY-MM-DD") : undefined,
  };
};

const mapDiaryItem = (diary: IMemoryDiary) => {
  return {
    id: String(diary._id),
    subject: diary.subject,
    diaryDate: dayjs(diary.diaryDate).toISOString(),
    displayDate: dayjs(diary.diaryDate).format("YYYY-MM-DD"),
    text: diary.text,
    generatedAt: dayjs(diary.generatedAt).toISOString(),
    updatedAt: dayjs(diary.updatedAt).toISOString(),
    displayUpdatedAt: dayjs(diary.updatedAt).format("YYYY-MM-DD HH:mm"),
  };
};

diaryRoute.get("/index", async (context) => {
  const query = parseDiaryQueryParams(context.req.raw);
  const skip = (query.page - 1) * query.pageSize;
  const readFrom: MongoReadSource = getYuijuConfig().app.publicDeployment ? "sync" : "primary";

  const baseOptions = {
    subject: DEFAULT_DIARY_SUBJECT,
    isDev: isDev(),
    diaryDateAfter: query.startDate,
    diaryDateBefore: query.endDateExclusive,
    sortDirection: "desc" as const,
    readFrom,
  };

  const [items, total] = await Promise.all([
    getMemoryDiaries({
      ...baseOptions,
      limit: query.pageSize,
      skip,
    }),
    countMemoryDiaries(baseOptions),
  ]);

  const totalPages = total > 0 ? Math.ceil(total / query.pageSize) : 1;

  return context.json({
    code: 0,
    data: {
      items: items.map((item) => mapDiaryItem(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasPrevPage: query.page > 1,
        hasNextPage: query.page < totalPages,
      },
      filters: {
        startDate: query.startDateText,
        endDate: query.endDateText,
      },
    },
    message: "ok",
  });
});
