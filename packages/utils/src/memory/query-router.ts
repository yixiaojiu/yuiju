import dayjs from "dayjs";
import { SUBJECT_NAME } from "../constants";
import { getMemoryDiaries, getRecentMemoryEpisodes } from "../db";
import { isDev } from "../env";
import { formatProjectTime, parseProjectTime } from "../time";
import { DEFAULT_DIARY_SUBJECT } from "./diary";

export type MemoryQueryTimeSort = "asc" | "desc";

export interface EpisodeSearchInput {
  startTime?: string;
  endTime?: string;
  timeSort?: MemoryQueryTimeSort;
  limit?: number;
}

export interface DiarySearchInput {
  startTime?: string;
  endTime?: string;
  timeSort?: MemoryQueryTimeSort;
  limit?: number;
}

export interface EpisodeSearchResult {
  time: string;
  event: string;
}

export interface DiarySearchResult {
  date: string;
  content: string;
}

/**
 * 查询今天的 Episode 记忆。
 *
 * 说明：
 * - 固定查询今天整天；
 * - 保留 timeSort 给上层控制返回顺序；
 * - 返回结果只保留 LLM 真正需要的时间和摘要。
 */
export async function searchEpisodes(input: EpisodeSearchInput): Promise<EpisodeSearchResult[]> {
  const limit = input.limit ?? 10;
  const timeSort = input.timeSort ?? "desc";
  const parsedStartTime = parseProjectTime(input.startTime?.trim() ?? "", "YYYY-MM-DD HH:mm:ss");
  const parsedEndTime = parseProjectTime(input.endTime?.trim() ?? "", "YYYY-MM-DD HH:mm:ss");

  const docs = await getRecentMemoryEpisodes({
    limit,
    subject: SUBJECT_NAME,
    isDev: isDev(),
    sortDirection: timeSort,
    onlyDate: parsedStartTime || parsedEndTime ? undefined : dayjs().toDate(),
    happenedAfter: parsedStartTime,
    happenedBefore: parsedEndTime,
  });

  return docs.map((doc) => ({
    time: formatProjectTime(doc.happenedAt, "HH:mm:ss"),
    event: doc.summaryText,
  }));
}

/**
 * 查询昨天及更早的 Diary 回忆。
 *
 * 说明：
 * - 只接受自然日范围；
 * - 如果不传日期范围，默认查询今天之前的全部日记；
 * - 返回结果只保留 LLM 真正需要的时间和正文。
 */
export async function searchDiaries(input: DiarySearchInput): Promise<DiarySearchResult[]> {
  const limit = input.limit ?? 5;
  const timeSort = input.timeSort ?? "desc";
  const parsedStartTime = parseProjectTime(input.startTime?.trim() ?? "", "YYYY-MM-DD HH:mm:ss");
  const parsedEndTime = parseProjectTime(input.endTime?.trim() ?? "", "YYYY-MM-DD HH:mm:ss");
  const startDay = parsedStartTime ? dayjs(parsedStartTime).startOf("day").toDate() : undefined;
  const endDay = parsedEndTime ? dayjs(parsedEndTime).startOf("day").toDate() : undefined;

  let diaryDateAfter: Date | undefined;
  let diaryDateBefore: Date | undefined;

  if (startDay || endDay) {
    const candidates = [startDay, endDay].filter((value): value is Date => Boolean(value));

    if (candidates.some((value) => dayjs(value).isSame(dayjs(), "day"))) {
      return [];
    }

    diaryDateAfter = startDay;
    diaryDateBefore = endDay ? dayjs(endDay).add(1, "day").toDate() : undefined;

    if (diaryDateAfter && diaryDateBefore && diaryDateAfter > diaryDateBefore) {
      [diaryDateAfter, diaryDateBefore] = [diaryDateBefore, diaryDateAfter];
    }
  } else {
    diaryDateBefore = dayjs().startOf("day").toDate();
  }

  const diaries = await getMemoryDiaries({
    limit,
    subject: DEFAULT_DIARY_SUBJECT,
    isDev: isDev(),
    sortDirection: timeSort,
    diaryDateAfter,
    diaryDateBefore,
  });

  return diaries.map((diary) => ({
    date: formatProjectTime(diary.diaryDate, "YYYY-MM-DD"),
    content: diary.text,
  }));
}
