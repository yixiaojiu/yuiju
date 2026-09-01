import {
  buildDiarySystemPrompt,
  DEFAULT_DIARY_SUBJECT,
  type DiarySummaryMaterial,
  getRecentMemoryEpisodes,
  type IMemoryEpisode,
  SUBJECT_NAME,
  summarizeConversationDiaryMaterials,
  updateCoreMemoryFromEpisodes,
  upsertMemoryDiary,
} from "@yuiju/utils";
import { getPromptCustomizationOverrides } from "@yuiju/utils/db/operations/prompt-customization";
import { generateStructuredOutput } from "@yuiju/utils/llm/generate-structured-output";
import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getFlashModel, getStrongModel } from "@yuiju/utils/llm/models";
import { indexDailyDiary } from "@yuiju/utils/memory/diary-vector-index";
import {
  buildDiaryReviewPrompt,
  buildDiaryRevisionPrompt,
  diaryReviewSystemPrompt,
} from "@yuiju/utils/prompt/diary";
import { getPromptCustomizationContent } from "@yuiju/utils/prompt/prompt-customization";
import { crossWorldRelationshipBoundaryPrompt } from "@yuiju/utils/prompt/world-view";
import { generateText, Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";

const SLEEP_DIARY_ROLLOVER_HOUR = 6;
const MAX_DIARY_REVIEW_ATTEMPTS = 5;

const diaryReviewResultSchema = z.strictObject({
  approved: z.boolean().describe("候选日记是否通过跨世界观审批。"),
  reason: z.string().min(1).describe("审批结论。"),
  issues: z.array(z.string().min(1)).describe("未通过时需要修正的问题；通过时为空数组。"),
});

export interface GenerateDailyMemoriesForDateInput {
  diaryDate: Date;
  subject?: string;
  isDev: boolean;
}

async function writeDiaryText(input: {
  diaryDate: Date;
  materials: DiarySummaryMaterial[];
}): Promise<string> {
  const materials = {
    worldFacts: input.materials
      .filter((item) => item.type !== "conversation" && item.type !== "conversation_summary")
      .map((item) => ({
        type: item.type,
        happenedAt: item.happenedAt,
        content: item.content,
      })),
    onlineConversations: input.materials
      .filter((item) => item.type === "conversation" || item.type === "conversation_summary")
      .map((item) => ({
        type: item.type,
        happenedAt: item.happenedAt,
        content: item.content,
      })),
  };
  const materialsJson = JSON.stringify(materials);
  const promptOverrides = await getPromptCustomizationOverrides(["character", "diary"]);
  const instructions = [
    getPromptCustomizationContent("character", promptOverrides),
    getPromptCustomizationContent("diary", promptOverrides),
    crossWorldRelationshipBoundaryPrompt,
    buildDiarySystemPrompt({ diaryDate: input.diaryDate }),
  ].join("\n\n");
  let diaryText = await generateDiaryDraft({
    instructions,
    materialsJson,
  });
  let lastReviewResult: z.infer<typeof diaryReviewResultSchema> | undefined;

  for (let attempt = 1; attempt <= MAX_DIARY_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      const { output: reviewResult } = await generateStructuredOutput({
        model: getStrongModel(),
        instructions: diaryReviewSystemPrompt,
        prompt: buildDiaryReviewPrompt({
          diaryDate: input.diaryDate,
          materialsJson,
          diaryText,
        }),
        output: Output.object({
          schema: diaryReviewResultSchema,
        }),
      });

      if (reviewResult.approved) {
        logger.info("[diary] candidate approved", {
          diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
          attempt,
        });
        return diaryText;
      }

      lastReviewResult = reviewResult;
      logger.warn("[diary] candidate rejected", {
        diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
        attempt,
        reason: reviewResult.reason,
        issues: reviewResult.issues,
      });

      try {
        diaryText = await generateDiaryDraft({
          instructions,
          materialsJson,
          revisionPrompt: buildDiaryRevisionPrompt({
            diaryText,
            reviewReason: reviewResult.reason,
            reviewIssues: reviewResult.issues,
          }),
        });
      } catch (error) {
        logger.error("[diary] candidate revision failed, keeping current candidate", error);
      }
    } catch (error) {
      logger.error("[diary] review failed, keeping current candidate", {
        diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
        attempt,
        error,
      });
    }
  }

  logger.warn("[diary] review attempts exhausted, writing last candidate", {
    diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    reviewReason: lastReviewResult?.reason,
    reviewIssues: lastReviewResult?.issues,
  });

  return diaryText;
}

async function generateDiaryDraft(input: {
  instructions: string;
  materialsJson: string;
  revisionPrompt?: string;
}): Promise<string> {
  const result = await generateText({
    model: getFlashModel(),
    telemetry: getLangfuseTelemetry(),
    providerOptions: {
      flash: {
        enable_thinking: true,
      },
    },
    instructions: input.instructions,
    prompt: [input.materialsJson, input.revisionPrompt].filter(Boolean).join("\n\n"),
  });

  return result.text.trim();
}

async function loadEpisodesForDate(input: {
  diaryDate: Date;
  subject: string;
  isDev: boolean;
}): Promise<IMemoryEpisode[]> {
  return await getRecentMemoryEpisodes({
    limit: 200,
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
 * - 聊天事件不再展开原始消息，统一压缩成带有线上发言归因的日记素材。
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
    conversationMaterials.length === 0
      ? []
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
 * 读取指定自然日的 Episode，并将同一份输入交给日记与核心记忆生成流程。
 */
export async function generateDailyMemoriesForDate(
  input: GenerateDailyMemoriesForDateInput,
): Promise<void> {
  const subject = input.subject ?? DEFAULT_DIARY_SUBJECT;
  const episodes = await loadEpisodesForDate({
    diaryDate: input.diaryDate,
    subject: SUBJECT_NAME,
    isDev: input.isDev,
  });

  if (episodes.length === 0) {
    logger.debug("[generateDailyMemoriesForDate] no episodes found", {
      subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return;
  }

  await Promise.all([
    generateDiaryFromEpisodes({
      subject,
      diaryDate: input.diaryDate,
      isDev: input.isDev,
      episodes,
    }).catch((error) => {
      logger.error("[generateDailyMemoriesForDate] diary generation failed", error);
    }),
    updateCoreMemoryFromEpisodes({
      date: input.diaryDate,
      episodes,
    })
      .then((result) => {
        logger.info("[generateDailyMemoriesForDate] core memory update completed", result);
      })
      .catch((error) => {
        logger.error("[generateDailyMemoriesForDate] core memory update failed", error);
      }),
  ]);
}

async function generateDiaryFromEpisodes(input: {
  subject: string;
  diaryDate: Date;
  isDev: boolean;
  episodes: IMemoryEpisode[];
}): Promise<void> {
  const materials = await buildDiaryMaterials(input.episodes);
  if (materials.length === 0) {
    logger.debug("[generateDailyMemoriesForDate] no diary materials built", {
      subject: input.subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return;
  }

  const diaryText = await writeDiaryText({
    diaryDate: input.diaryDate,
    materials,
  });

  if (!diaryText.trim()) {
    logger.warn("[generateDailyMemoriesForDate] generated empty diary text", {
      subject: input.subject,
      diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
    });
    return;
  }

  const diary = await upsertMemoryDiary({
    subject: input.subject,
    diaryDate: input.diaryDate,
    diaryEndDate: input.diaryDate,
    text: diaryText,
    isDev: input.isDev,
  });
  await indexDailyDiary(diary);

  logger.info("[generateDailyMemoriesForDate] diary generated", {
    subject: input.subject,
    diaryDate: dayjs(input.diaryDate).format("YYYY-MM-DD"),
  });
}
