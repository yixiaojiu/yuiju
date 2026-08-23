import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildGroupMemoryProposalPrompt,
  buildGroupMemoryReviewPrompt,
  createToolCallLoggingHooks,
  formatProjectTime,
  generateStructuredOutput,
  getTimeWithWeekday,
  logger,
} from "@yuiju/utils";
import { getYuijuConfig } from "@yuiju/utils/config/config";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { Output, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import {
  getProtocolMessageId,
  getProtocolMessageSenderName,
  getProtocolMessageTimestampMs,
  projectStoredMessageContent,
  type StoredSatoriGroupMessage,
} from "@/utils/message";

const GROUP_MEMORY_SECTION_KEYS = ["群聊印象"] as const;
const GROUP_MEMORY_SECTION_MAX_LENGTH = 300;
const EMPTY_GROUP_MEMORY_SECTION = "（暂无）";

type GroupMemorySectionKey = (typeof GROUP_MEMORY_SECTION_KEYS)[number];

export interface GroupMemoryDocument {
  sessionId: string;
  sessionLabel: string;
  lastUpdatedAt: string;
  sections: Record<GroupMemorySectionKey, string>;
}

export interface GroupChatWindowState {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: StoredSatoriGroupMessage[];
}

interface GroupMemoryProposal {
  shouldUpdate: boolean;
  changes: {
    section: GroupMemorySectionKey;
    content: string;
    reason: string;
  }[];
}

interface GroupMemoryProposalContext {
  sessionLabel: string;
  currentTime: string;
  interactionMaterial: string;
  existingMemory?: GroupMemoryDocument;
}

const groupMemorySectionsSchema = z.strictObject({
  群聊印象: z.string(),
});

const groupMemoryDocumentSchema = z.strictObject({
  sessionId: z.string().min(1),
  sessionLabel: z.string().min(1),
  lastUpdatedAt: z.string().min(1),
  sections: groupMemorySectionsSchema,
});

const groupMemoryProposalSchema = z.strictObject({
  shouldUpdate: z.boolean().describe("这轮是否需要写回群聊记忆。"),
  changes: z
    .array(
      z.strictObject({
        section: z.enum(GROUP_MEMORY_SECTION_KEYS).describe("准备修改的群聊记忆标题。"),
        content: z
          .string()
          .min(1)
          .max(GROUP_MEMORY_SECTION_MAX_LENGTH)
          .describe("该标题修改后的完整正文，必须用悠酱第一人称口吻记录。"),
        reason: z.string().min(1).describe("为什么这样修改，依据必须来自本次群聊材料。"),
      }),
    )
    .describe("要修改的标题列表。"),
});

const groupMemoryReviewSchema = z.strictObject({
  approved: z.boolean().describe("是否通过审查。"),
  reason: z.string().min(1).describe("审查结论。"),
  issues: z
    .array(z.string().min(1))
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("未通过时需要修正的问题列表。"),
});

export async function getGroupMemory(sessionId: string): Promise<GroupMemoryDocument | null> {
  try {
    const content = await readFile(getGroupMemoryFilePath(sessionId), "utf8");
    return parseGroupMemoryJson(content);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getGroupMemoryPromptSection(input: {
  sessionId: string;
  sessionLabel: string;
}): Promise<string> {
  const memory = await getGroupMemory(input.sessionId);
  if (!memory) {
    return `
## 当前群聊长期感受
群聊：${input.sessionLabel}
当前还没有形成稳定群聊印象。
`.trim();
  }

  return `
## 当前群聊长期感受
群聊：${memory.sessionLabel}
悠酱对这个群的印象：${memory.sections["群聊印象"]}
`.trim();
}

export async function updateGroupMemoryForChatWindow(input: {
  sessionId: string;
  state: GroupChatWindowState;
}): Promise<void> {
  const existingMemory = await getGroupMemory(input.sessionId);
  const currentTime = formatProjectTime(new Date(), "YYYY-MM-DD");
  const proposal = await generateGroupMemoryProposal({
    sessionLabel: input.state.sessionLabel,
    currentTime,
    existingMemory: existingMemory ?? undefined,
    interactionMaterial: buildGroupInteractionMaterial(input.state),
  });

  if (!proposal || !proposal.shouldUpdate) {
    return;
  }

  const nextMemory = applyProposalToDocument({
    sessionId: input.sessionId,
    sessionLabel: input.state.sessionLabel,
    existingMemory,
    proposal,
  });

  const filePath = getGroupMemoryFilePath(input.sessionId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(nextMemory, null, 2)}\n`, "utf8");
}

function getGroupMemoryFilePath(sessionId: string): string {
  return resolve(getYuijuConfig().app.memoryDir, "groups", `${encodeURIComponent(sessionId)}.json`);
}

function parseGroupMemoryJson(content: string): GroupMemoryDocument {
  const parsed = groupMemoryDocumentSchema.parse(JSON.parse(content));

  return {
    sessionId: parsed.sessionId,
    sessionLabel: parsed.sessionLabel,
    lastUpdatedAt: parsed.lastUpdatedAt,
    sections: {
      群聊印象: normalizeGroupMemorySection(parsed.sections["群聊印象"]),
    },
  };
}

function normalizeGroupMemorySection(value: string): string {
  const normalized = value.trim();
  return normalized || EMPTY_GROUP_MEMORY_SECTION;
}

async function generateGroupMemoryProposal(
  input: GroupMemoryProposalContext,
): Promise<GroupMemoryProposal | null> {
  const { output } = await generateStructuredOutput({
    model: getFlashModel(),
    providerOptions: {
      flash: {
        enable_thinking: true,
      },
    },
    tools: {
      reviewGroupMemoryProposal: reviewGroupMemoryProposalTool(input),
    },
    output: Output.object({
      schema: groupMemoryProposalSchema,
    }),
    prompt: buildGroupMemoryProposalPrompt({
      sessionLabel: input.sessionLabel,
      currentTime: input.currentTime,
      existingMemoryText: input.existingMemory
        ? JSON.stringify(input.existingMemory, null, 2)
        : "（无，当前尚未建立群聊记忆）",
      interactionMaterial: input.interactionMaterial,
      sectionKeys: GROUP_MEMORY_SECTION_KEYS,
      sectionMaxLength: GROUP_MEMORY_SECTION_MAX_LENGTH,
    }),
    stopWhen: stepCountIs(20),
    ...createToolCallLoggingHooks({
      scene: "group-memory",
    }),
  });

  return normalizeProposal(output);
}

function reviewGroupMemoryProposalTool(input: GroupMemoryProposalContext) {
  return tool({
    description: "审查候选群聊记忆提案是否合规。只有审查通过后，主 agent 才能输出最终 proposal。",
    inputSchema: z.strictObject({
      proposal: groupMemoryProposalSchema,
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
          schema: groupMemoryReviewSchema,
        }),
        prompt: buildGroupMemoryReviewPrompt({
          sessionLabel: input.sessionLabel,
          currentTime: input.currentTime,
          interactionMaterial: input.interactionMaterial,
          existingMemoryText: input.existingMemory
            ? JSON.stringify(input.existingMemory, null, 2)
            : "（无，当前尚未建立群聊记忆）",
          proposalJson: JSON.stringify(normalizedProposal, null, 2),
          sectionMaxLength: GROUP_MEMORY_SECTION_MAX_LENGTH,
        }),
      });

      const issues = output.issues?.map((item) => item.trim()).filter((item) => item.length > 0);

      logger.debug("[group-memory] review", proposal, output);

      return {
        approved: output.approved,
        reason: output.reason.trim(),
        issues: issues?.length ? issues : undefined,
      };
    },
  });
}

function applyProposalToDocument(input: {
  sessionId: string;
  sessionLabel: string;
  existingMemory: GroupMemoryDocument | null;
  proposal: GroupMemoryProposal;
}): GroupMemoryDocument {
  const sections = input.existingMemory
    ? { ...input.existingMemory.sections }
    : GROUP_MEMORY_SECTION_KEYS.reduce(
        (result, section) => {
          result[section] = EMPTY_GROUP_MEMORY_SECTION;
          return result;
        },
        {} as Record<GroupMemorySectionKey, string>,
      );

  for (const change of input.proposal.changes) {
    sections[change.section] = normalizeGroupMemorySection(change.content);
  }

  for (const section of GROUP_MEMORY_SECTION_KEYS) {
    sections[section] = normalizeGroupMemorySection(sections[section]);
  }

  return {
    sessionId: input.sessionId,
    sessionLabel: input.sessionLabel,
    lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
    sections,
  };
}

function normalizeProposal(output: z.infer<typeof groupMemoryProposalSchema>): GroupMemoryProposal {
  return {
    shouldUpdate: output.shouldUpdate,
    changes: output.changes.map((change) => ({
      section: change.section,
      content: normalizeGroupMemorySection(change.content),
      reason: change.reason.trim(),
    })),
  };
}

function buildGroupInteractionMaterial(state: GroupChatWindowState): string {
  const transcript = state.messages.map((message) => ({
    messageId: getProtocolMessageId(message),
    speaker: getProtocolMessageSenderName(message) || "未知用户",
    time: getTimeWithWeekday(dayjs(getProtocolMessageTimestampMs(message))),
    content: projectStoredMessageContent(message),
  }));

  return [
    `会话：${state.sessionLabel}`,
    `时间范围：${getTimeWithWeekday(dayjs(state.windowStartMs))} 至 ${getTimeWithWeekday(dayjs(state.lastTsMs))}`,
    "对话材料：",
    JSON.stringify(transcript, null, 2),
  ].join("\n");
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
