import {
  buildDiarySystemPrompt,
  DEFAULT_DIARY_SUBJECT,
  type DiarySummaryMaterial,
  flashModel,
  getRecentMemoryEpisodes,
  type IMemoryEpisode,
  SUBJECT_NAME,
  summarizeConversationDiaryMaterials,
  upsertMemoryDiary,
} from "@yuiju/utils";
import { generateText } from "ai";
import dayjs from "dayjs";
import { logger } from "@/utils/logger";

const MAX_EPISODES_PER_DAY = 500;
const SLEEP_DIARY_ROLLOVER_HOUR = 6;
const CONVERSATION_SUMMARY_CHAR_BUDGET = 20_000;

export interface GenerateDiaryForDateInput {
  diaryDate: Date;
  subject?: string;
  isDev: boolean;
}

function estimateDiaryMaterialChars(materials: DiarySummaryMaterial[]): number {
  return materials.reduce((total, material) => {
    return total + material.type.length + material.happenedAt.length + material.content.length;
  }, 0);
}

async function writeDiaryText(input: {
  subject: string;
  diaryDate: Date;
  materials: DiarySummaryMaterial[];
}): Promise<string> {
  const result = await generateText({
    model: flashModel,
    providerOptions: {
      flash: {
        enable_thinking: false,
      },
    },
    system: buildDiarySystemPrompt({
      subject: input.subject,
      diaryDate: input.diaryDate,
    }),
    prompt: [
      "以下是今天真实发生过的素材，请严格基于这些内容写日记。",
      JSON.stringify(
        input.materials.map((item) => ({
          type: item.type,
          happenedAt: item.happenedAt,
          content: item.content,
        })),
      ),
    ].join("\n"),
  });

  return result.text.trim();
}

async function loadEpisodesForDiary(input: {
  diaryDate: Date;
  subject: string;
  isDev: boolean;
}): Promise<IMemoryEpisode[]> {
  return await getRecentMemoryEpisodes({
    limit: MAX_EPISODES_PER_DAY,
    subject: input.subject,
    isDev: input.isDev,
    onlyDate: input.diaryDate,
    sortDirection: "asc",
  });
}

/**
 * 将同一天的 Episode 转换成适合写日记的素材列表。
 *
 * 说明：
 * - Episode 写入时已经把关键信息放进 summaryText；
 * - 非聊天事件直接保留摘要；
 * - 聊天事件不再展开原始消息，只在聊天摘要总量过大时整体压缩一次。
 */
export async function buildDiaryMaterials(
  episodes: IMemoryEpisode[],
): Promise<DiarySummaryMaterial[]> {
  const nonConversationMaterials = episodes
    .filter((episode) => episode.type !== "conversation")
    .map(function buildEpisodeMaterial(episode: IMemoryEpisode): DiarySummaryMaterial {
      return {
        type: episode.type,
        happenedAt: dayjs(episode.happenedAt).toISOString(),
        content: episode.summaryText,
      };
    });

  const conversationMaterials = episodes
    .filter((episode) => episode.type === "conversation")
    .map(function buildConversationMaterial(episode: IMemoryEpisode): DiarySummaryMaterial {
      return {
        type: episode.type,
        happenedAt: dayjs(episode.happenedAt).toISOString(),
        content: episode.summaryText,
      };
    });

  const finalConversationMaterials =
    estimateDiaryMaterialChars(conversationMaterials) <= CONVERSATION_SUMMARY_CHAR_BUDGET
      ? conversationMaterials
      : [await summarizeConversationDiaryMaterials(conversationMaterials)];

  return [...nonConversationMaterials, ...finalConversationMaterials].sort((left, right) => {
    return dayjs(left.happenedAt).valueOf() - dayjs(right.happenedAt).valueOf();
  });
}

/**
 * 将“入睡时刻”映射为应写入的日记日期。
 *
 * 说明：
 * - 22:00-23:59 入睡，记为当天；
 * - 00:00-05:59 熬夜后入睡，记为前一天；
 * - 该规则与当前 isNight 的时间边界保持一致。
 */
export function resolveDiaryDateForSleep(happenedAt: Date): Date {
  const sleepTime = dayjs(happenedAt);

  if (sleepTime.hour() < SLEEP_DIARY_ROLLOVER_HOUR) {
    return sleepTime.subtract(1, "day").startOf("day").toDate();
  }

  return sleepTime.startOf("day").toDate();
}

/**
 * 为指定自然日生成或覆盖一篇 Diary。
 */
export async function generateDiaryForDate(input: GenerateDiaryForDateInput): Promise<boolean> {
  const subject = input.subject ?? DEFAULT_DIARY_SUBJECT;
  const episodes = await loadEpisodesForDiary({
    diaryDate: input.diaryDate,
    subject: SUBJECT_NAME,
    isDev: input.isDev,
  });

  if (episodes.length === 0) {
    logger.debug("[generateDiaryForDate] no episodes found", {
      subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return false;
  }

  const materials = await buildDiaryMaterials(episodes);
  if (materials.length === 0) {
    logger.debug("[generateDiaryForDate] no diary materials built", {
      subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return false;
  }

  const diaryText = await writeDiaryText({
    subject,
    diaryDate: input.diaryDate,
    materials,
  });

  if (!diaryText.trim()) {
    logger.warn("[generateDiaryForDate] generated empty diary text", {
      subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return false;
  }

  await upsertMemoryDiary({
    subject,
    diaryDate: input.diaryDate,
    text: diaryText,
    isDev: input.isDev,
  });

  logger.info("[generateDiaryForDate] diary generated", {
    subject,
    diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
  });

  return true;
}
