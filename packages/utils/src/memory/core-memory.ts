import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Output, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { getYuijuConfig } from "../config/config";
import type { IMemoryEpisode } from "../db";
import { createToolCallLoggingHooks, generateStructuredOutput } from "../llm";
import { getChatModel, getFlashModel } from "../llm/models";
import { logger } from "../logger";
import { buildCoreMemoryProposalPrompt, buildCoreMemoryReviewPrompt } from "../prompt";

export type CoreMemoryUpdateResult =
  | { status: "skipped" }
  | { status: "created" }
  | { status: "updated" }
  | { status: "review_rejected" };

interface CoreMemoryProposal {
  shouldUpdate: boolean;
  content: string;
}

const coreMemoryProposalSchema = z.strictObject({
  shouldUpdate: z.boolean().describe("是否需要更新核心记忆。"),
  content: z.string().describe("准备写入 memory.md 的完整正文；不更新时为空字符串。"),
});

const coreMemoryReviewSchema = z.strictObject({
  approved: z.boolean().describe("候选核心记忆是否通过审查。"),
  reason: z.string().min(1).describe("审查结论。"),
  issues: z
    .array(z.string().min(1))
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("未通过时需要修正的问题。"),
});

function getCoreMemoryDirectoryPath(): string {
  return resolve(getYuijuConfig().app.memoryDir, "core");
}

function getCoreMemoryFilePath(): string {
  return resolve(getCoreMemoryDirectoryPath(), "memory.md");
}

export async function readCoreMemory(): Promise<string | null> {
  try {
    return (await readFile(getCoreMemoryFilePath(), "utf8")).trim();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeCoreMemory(content: string): Promise<void> {
  await mkdir(getCoreMemoryDirectoryPath(), { recursive: true });
  await writeFile(getCoreMemoryFilePath(), `${content.trim()}\n`, "utf8");
}

export async function updateCoreMemoryFromEpisodes(input: {
  date: Date;
  episodes: IMemoryEpisode[];
}): Promise<CoreMemoryUpdateResult> {
  if (input.episodes.length === 0) {
    return { status: "skipped" };
  }

  const existingMemory = await readCoreMemory();
  const episodeMaterialJson = JSON.stringify(
    input.episodes.map((episode) => ({
      id: episode._id.toString(),
      happenedAt: dayjs(episode.happenedAt).toISOString(),
      type: episode.type,
      summaryText: episode.summaryText,
    })),
    null,
    2,
  );
  const generation = await generateCoreMemoryProposal({
    memoryDate: dayjs(input.date).format("YYYY-MM-DD"),
    existingMemoryText: existingMemory || "（无，当前尚未形成核心记忆）",
    episodeMaterialJson,
  });

  if (!generation.proposal.shouldUpdate) {
    return { status: "skipped" };
  }

  if (!generation.approved) {
    return { status: "review_rejected" };
  }

  await writeCoreMemory(generation.proposal.content);

  return {
    status: existingMemory === null ? "created" : "updated",
  };
}

async function generateCoreMemoryProposal(input: {
  memoryDate: string;
  existingMemoryText: string;
  episodeMaterialJson: string;
}): Promise<{ proposal: CoreMemoryProposal; approved: boolean }> {
  let approvedProposal: string | null = null;

  const { output } = await generateStructuredOutput({
    model: getChatModel(),
    providerOptions: {
      chat: {
        enable_thinking: true,
      },
    },
    tools: {
      reviewCoreMemoryProposal: tool({
        description: "审查候选核心记忆提案。只有审查通过的完整提案才能写入记忆文件。",
        inputSchema: z.strictObject({
          proposal: coreMemoryProposalSchema,
        }),
        execute: async ({ proposal }) => {
          const normalizedProposal = normalizeCoreMemoryProposal(proposal);
          const { output: review } = await generateStructuredOutput({
            model: getFlashModel(),
            providerOptions: {
              flash: {
                enable_thinking: true,
              },
            },
            output: Output.object({
              schema: coreMemoryReviewSchema,
            }),
            prompt: buildCoreMemoryReviewPrompt({
              ...input,
              proposalJson: JSON.stringify(normalizedProposal, null, 2),
            }),
          });

          if (review.approved) {
            approvedProposal = JSON.stringify(normalizedProposal);
          }

          const issues = review.issues
            ?.map((issue) => issue.trim())
            .filter((issue) => issue.length > 0);

          logger.debug("[core-memory] review", normalizedProposal, review);

          return {
            approved: review.approved,
            reason: review.reason.trim(),
            issues: issues?.length ? issues : undefined,
          };
        },
      }),
    },
    output: Output.object({
      schema: coreMemoryProposalSchema,
    }),
    prompt: buildCoreMemoryProposalPrompt(input),
    stopWhen: stepCountIs(20),
    ...createToolCallLoggingHooks({
      scene: "memory.core.update",
    }),
  });

  const proposal = normalizeCoreMemoryProposal(output);

  return {
    proposal,
    approved: !proposal.shouldUpdate || approvedProposal === JSON.stringify(proposal),
  };
}

function normalizeCoreMemoryProposal(
  proposal: z.infer<typeof coreMemoryProposalSchema>,
): CoreMemoryProposal {
  return {
    shouldUpdate: proposal.shouldUpdate,
    content: proposal.content.trim(),
  };
}
