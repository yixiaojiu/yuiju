import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { Output, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { createToolCallLoggingHooks, generateStructuredOutput } from "../../llm";
import { getFlashModel } from "../../llm/models";
import { logger } from "../../logger";
import { buildPersonMemoryProposalPrompt, buildPersonMemoryReviewPrompt } from "../../prompt";
import { formatProjectTime } from "../../time";
import { normalizeSectionContent, PersonMemoryFormatError } from "./format";
import {
  getPersonMemoryHeatFilePath,
  readPersonMemoryHeatDocument,
  updatePersonMemoryHeat,
} from "./heat";
import { getPersonMemoryFilePath, isFileNotFoundError, parsePersonMemoryJson } from "./storage";
import {
  EMPTY_PERSON_MEMORY_SECTION,
  PERSON_MEMORY_SECTION_KEYS,
  type PersonMemoryDocument,
  type PersonMemoryProposal,
  type PersonMemorySectionKey,
  type PersonMemoryUpdateInput,
  type PersonMemoryUpdateResult,
} from "./types";

const PERSON_MEMORY_PRUNE_SCORE_THRESHOLD = -30;

interface PersonMemoryProposalContext {
  scene: "private" | "group";
  nickname: string;
  interactionMaterial: string;
  existingMemory?: PersonMemoryDocument;
}

interface PersonMemoryReviewContext {
  scene: "private" | "group";
  nickname: string;
  currentTime: string;
  interactionMaterial: string;
  existingMemory?: PersonMemoryDocument;
  proposal: PersonMemoryProposal;
}

const personMemoryProposalSchema = z.strictObject({
  shouldUpdate: z.boolean().describe("这轮是否需要写回人物记忆。"),
  changes: z
    .array(
      z.strictObject({
        section: z.enum(PERSON_MEMORY_SECTION_KEYS).describe("准备修改的人物记忆标题。"),
        content: z.string().min(1).describe("该标题修改后的完整正文。"),
        reason: z.string().min(1).describe("为什么这样修改，依据必须来自本次互动材料。"),
      }),
    )
    .describe("要修改的标题列表"),
});

const personMemoryReviewSchema = z.strictObject({
  approved: z.boolean().describe("是否通过审查。"),
  reason: z.string().min(1).describe("审查结论。"),
  issues: z
    .array(z.string().min(1))
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("未通过时需要修正的问题列表。"),
});

export async function updatePersonMemory(
  input: PersonMemoryUpdateInput,
): Promise<PersonMemoryUpdateResult> {
  const filePath = await getPersonMemoryFilePath(input.nickname);
  let existingMemory: PersonMemoryDocument | null = null;

  await updatePersonMemoryHeat({
    nickname: input.nickname,
    interactionCount: input.interactionCount,
  });

  await pruneInactivePersonMemories({
    protectedNickname: input.nickname,
  });

  try {
    const content = await readFile(filePath, "utf8");
    existingMemory = parsePersonMemoryJson(content);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      existingMemory = null;
    } else if (error instanceof PersonMemoryFormatError) {
      return {
        status: "malformed_existing_file",
      };
    } else {
      throw error;
    }
  }

  const proposal = await generatePersonMemoryProposal({
    scene: input.scene,
    nickname: input.nickname,
    interactionMaterial: input.interactionMaterial,
    existingMemory: existingMemory ?? undefined,
  });

  // TODO 记录日志

  if (!proposal || !proposal.shouldUpdate) {
    return {
      status: "skipped",
    };
  }

  const nextMemory = applyPersonMemoryProposalToDocument({
    nickname: input.nickname,
    existingMemory,
    proposal,
  });

  await writeFile(filePath, `${JSON.stringify(nextMemory, null, 2)}\n`, "utf8");

  return {
    status: existingMemory ? "updated" : "created",
  };
}

async function generatePersonMemoryProposal(
  input: PersonMemoryProposalContext,
): Promise<PersonMemoryProposal | null> {
  const currentTime = formatProjectTime(new Date(), "YYYY-MM-DD");

  const { output } = await generateStructuredOutput({
    model: getFlashModel(),
    providerOptions: {
      flash: {
        enable_thinking: true,
      },
    },
    tools: {
      reviewPersonMemoryProposal: reviewPersonMemoryProposalTool({
        scene: input.scene,
        nickname: input.nickname,
        currentTime,
        interactionMaterial: input.interactionMaterial,
        existingMemory: input.existingMemory,
      }),
    },
    output: Output.object({
      schema: personMemoryProposalSchema,
    }),
    prompt: buildPersonMemoryProposalPrompt({
      scene: input.scene,
      nickname: input.nickname,
      currentTime,
      interactionMaterial: input.interactionMaterial,
      existingMemoryText: input.existingMemory
        ? JSON.stringify(input.existingMemory, null, 2)
        : "（无，当前尚未建立人物记忆）",
      sectionKeys: PERSON_MEMORY_SECTION_KEYS,
    }),
    stopWhen: stepCountIs(20),
    ...createToolCallLoggingHooks({
      scene: input.scene,
    }),
  });

  const proposal = normalizeProposal(output);

  return proposal;
}

function reviewPersonMemoryProposalTool(input: Omit<PersonMemoryReviewContext, "proposal">) {
  return tool({
    description: "审查候选人物记忆提案是否合规。只有审查通过后，主 agent 才能输出最终 proposal。",
    inputSchema: z.strictObject({
      proposal: personMemoryProposalSchema,
    }),
    execute: async ({ proposal }) => {
      const normalizedProposal = normalizeProposal(proposal);
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        providerOptions: {
          flash: {
            enable_thinking: true,
          },
        },
        output: Output.object({
          schema: personMemoryReviewSchema,
        }),
        prompt: buildPersonMemoryReviewPrompt({
          scene: input.scene,
          nickname: input.nickname,
          currentTime: input.currentTime,
          interactionMaterial: input.interactionMaterial,
          existingMemoryText: input.existingMemory
            ? JSON.stringify(input.existingMemory, null, 2)
            : "（无，当前尚未建立人物记忆）",
          proposalJson: JSON.stringify(normalizedProposal, null, 2),
        }),
      });

      const issues = output.issues?.map((item) => item.trim()).filter((item) => item.length > 0);

      logger.debug("[person-memory] review", proposal, output);

      return {
        approved: output.approved,
        reason: output.reason.trim(),
        issues: issues?.length ? issues : undefined,
      };
    },
  });
}

export function applyPersonMemoryProposalToDocument(input: {
  nickname: string;
  existingMemory: PersonMemoryDocument | null;
  proposal: PersonMemoryProposal;
}): PersonMemoryDocument {
  const sections = input.existingMemory
    ? { ...input.existingMemory.sections }
    : PERSON_MEMORY_SECTION_KEYS.reduce(
        (result, section) => {
          result[section] = EMPTY_PERSON_MEMORY_SECTION;
          return result;
        },
        {} as Record<PersonMemorySectionKey, string>,
      );

  for (const change of input.proposal.changes) {
    sections[change.section] = normalizeSectionContent(change.content);
  }

  for (const section of PERSON_MEMORY_SECTION_KEYS) {
    sections[section] = normalizeSectionContent(sections[section]);
  }

  return {
    nickname: input.nickname,
    lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
    sections,
  };
}

/**
 * 清理过期的人物记忆
 */
async function pruneInactivePersonMemories(input: { protectedNickname: string }): Promise<void> {
  const heatDocument = await readPersonMemoryHeatDocument();
  let shouldWriteHeatFile = false;

  for (const [nickname, heatEntry] of Object.entries(heatDocument)) {
    if (nickname === input.protectedNickname) {
      continue;
    }

    const filePath = await getPersonMemoryFilePath(nickname);
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        throw new Error(`人物记忆路径不是文件：${filePath}`);
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }

      delete heatDocument[nickname];
      shouldWriteHeatFile = true;
      continue;
    }

    const daysSinceLastInteracted = Math.max(
      0,
      dayjs().diff(dayjs(heatEntry.lastInteractedAt), "day", true),
    );
    const score = heatEntry.heat - daysSinceLastInteracted;

    if (score >= PERSON_MEMORY_PRUNE_SCORE_THRESHOLD) {
      continue;
    }

    await unlink(filePath);
    delete heatDocument[nickname];
    shouldWriteHeatFile = true;
  }

  if (!shouldWriteHeatFile) {
    return;
  }

  await writeFile(
    await getPersonMemoryHeatFilePath(),
    `${JSON.stringify(heatDocument, null, 2)}\n`,
    "utf8",
  );
}

function normalizeProposal(
  output: z.infer<typeof personMemoryProposalSchema>,
): PersonMemoryProposal {
  return {
    shouldUpdate: output.shouldUpdate,
    changes: output.changes.map((change) => ({
      section: change.section,
      content: normalizeSectionContent(change.content),
      reason: change.reason.trim(),
    })),
  };
}
