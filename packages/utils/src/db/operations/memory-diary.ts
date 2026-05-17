import dayjs from "dayjs";
import { hasSyncMongoUri, type MongoReadSource } from "../connect";
import { getMemoryDiaryModel, type IMemoryDiary } from "../schema/memory-diary.schema";

export interface MemoryDiaryWriteInput {
  subject: string;
  diaryDate: Date;
  text: string;
  isDev?: boolean;
}

export interface GetMemoryDiariesOptions {
  limit?: number;
  skip?: number;
  subject?: string;
  isDev?: boolean;
  onlyDate?: Date;
  diaryDateAfter?: Date;
  diaryDateBefore?: Date;
  sortDirection?: "asc" | "desc";
  readFrom?: MongoReadSource;
}

function normalizeDiaryDate(value: Date): Date {
  return dayjs(value).startOf("day").toDate();
}

/**
 * 统一构建 Diary 查询条件。
 *
 * 说明：
 * - 日期过滤在这里集中归一化，避免列表查询与总数统计出现条件漂移；
 * - `diaryDateBefore` 语义上是排他上界，便于调用方表达“结束日期 + 1 天”。
 */
function buildMemoryDiaryFilter(options: GetMemoryDiariesOptions = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (options.subject) {
    filter.subject = options.subject;
  }
  if (typeof options.isDev === "boolean") {
    filter.isDev = options.isDev;
  }
  if (options.onlyDate) {
    filter.diaryDate = normalizeDiaryDate(options.onlyDate);
  } else if (options.diaryDateAfter || options.diaryDateBefore) {
    filter.diaryDate = {};
    if (options.diaryDateAfter) {
      (filter.diaryDate as Record<string, Date>).$gte = normalizeDiaryDate(options.diaryDateAfter);
    }
    if (options.diaryDateBefore) {
      (filter.diaryDate as Record<string, Date>).$lt = normalizeDiaryDate(options.diaryDateBefore);
    }
  }

  return filter;
}

/**
 * 按“同主体 + 同自然日”幂等写入或覆盖日记。
 */
export async function upsertMemoryDiary(input: MemoryDiaryWriteInput): Promise<IMemoryDiary> {
  const diaryDate = normalizeDiaryDate(input.diaryDate);
  const now = new Date();
  const model = await getMemoryDiaryModel();

  const diary = await model
    .findOneAndUpdate(
      {
        subject: input.subject,
        diaryDate,
        isDev: input.isDev ?? false,
      },
      {
        $set: {
          text: input.text,
          generatedAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          subject: input.subject,
          diaryDate,
          isDev: input.isDev ?? false,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    )
    .exec();

  if (!diary) {
    throw new Error("upsertMemoryDiary failed");
  }

  await syncMemoryDiaryDocument(diary);
  return diary;
}

/**
 * 查询 Diary 条目。
 *
 * 说明：
 * - onlyDate 用于自然日精确匹配；
 * - 区间查询统一按 diaryDate 过滤，适配昨天及更早的日记回忆。
 */
export async function getMemoryDiaries(
  options: GetMemoryDiariesOptions = {},
): Promise<IMemoryDiary[]> {
  const filter = buildMemoryDiaryFilter(options);
  const sortDirection = options.sortDirection === "asc" ? 1 : -1;
  const model = await getMemoryDiaryModel(options.readFrom);

  return await model
    .find(filter)
    .sort({ diaryDate: sortDirection, updatedAt: sortDirection })
    .skip(Math.max(0, options.skip ?? 0))
    .limit(options.limit ?? 10)
    .exec();
}

/**
 * 统计 Diary 条目总数。
 *
 * 说明：
 * - 与列表查询复用同一套 filter 构建逻辑，确保分页总数与列表结果一致。
 */
export async function countMemoryDiaries(options: GetMemoryDiariesOptions = {}): Promise<number> {
  const model = await getMemoryDiaryModel(options.readFrom);
  return await model.countDocuments(buildMemoryDiaryFilter(options)).exec();
}

async function syncMemoryDiaryDocument(diary: IMemoryDiary): Promise<void> {
  if (!hasSyncMongoUri()) {
    return;
  }

  try {
    const syncModel = await getMemoryDiaryModel("sync");
    await syncModel
      .replaceOne(
        { subject: diary.subject, diaryDate: diary.diaryDate, isDev: diary.isDev },
        {
          _id: diary._id,
          subject: diary.subject,
          diaryDate: diary.diaryDate,
          text: diary.text,
          generatedAt: diary.generatedAt,
          updatedAt: diary.updatedAt,
          isDev: diary.isDev,
        },
        { upsert: true },
      )
      .exec();
  } catch (error) {
    console.error(`Sync Mongo write failed: memory_diary ${diary._id}`, error);
  }
}
