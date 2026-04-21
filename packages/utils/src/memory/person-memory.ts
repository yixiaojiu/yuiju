import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Output, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { getYuijuConfig } from "../config";
import { generateStructuredOutput } from "../llm";
import { qwen3Model } from "../llm/models";
import { buildPersonMemoryProposalPrompt, buildPersonMemoryReviewPrompt } from "../prompt";
import { formatProjectTime } from "../time";

export const PERSON_MEMORY_SECTION_KEYS = [
  "称呼",
  "喜好",
  "雷区",
  "最近在忙什么",
  "悠酱对她的态度",
  "最近一次值得记住的互动",
  "其他补充",
] as const;

export const EMPTY_PERSON_MEMORY_SECTION = "（暂无）";

export type PersonMemorySectionKey = (typeof PERSON_MEMORY_SECTION_KEYS)[number];

export interface PersonMemoryDocument {
  personId: string;
  lastUpdatedAt: string;
  sections: Record<PersonMemorySectionKey, string>;
}

export interface PersonMemoryUpdateInput {
  personId: string;
  displayName: string;
  interactionMaterial: string;
  scene: "private" | "group";
}

export interface PersonMemoryUpdateResult {
  status: "skipped" | "created" | "updated" | "review_rejected" | "malformed_existing_file";
}

export interface PersonMemoryDirectoryItem {
  personId: string;
  displayName: string;
  appellation: string;
}

export interface PersonMemoryContentResult {
  personId: string;
  displayName: string;
  memory: PersonMemoryDocument;
}

export interface PersonMemoryProposalChange {
  section: PersonMemorySectionKey;
  content: string;
  reason: string;
}

export interface PersonMemoryProposal {
  shouldUpdate: boolean;
  displayName: string;
  changes: PersonMemoryProposalChange[];
}

interface PersonMemoryProposalContext {
  personId: string;
  scene: "private" | "group";
  displayName: string;
  interactionMaterial: string;
  existingMemory?: PersonMemoryDocument;
}

interface PersonMemoryReviewContext {
  personId: string;
  scene: "private" | "group";
  interactionMaterial: string;
  existingMemory?: PersonMemoryDocument;
  proposal: PersonMemoryProposal;
}

const personMemorySectionsSchema = z.strictObject({
  称呼: z.string(),
  喜好: z.string(),
  雷区: z.string(),
  最近在忙什么: z.string(),
  悠酱对她的态度: z.string(),
  最近一次值得记住的互动: z.string(),
  其他补充: z.string(),
});

const personMemoryDocumentSchema = z.strictObject({
  personId: z.string().min(1),
  lastUpdatedAt: z.string().min(1),
  sections: personMemorySectionsSchema,
});

const personMemoryProposalSchema = z.strictObject({
  shouldUpdate: z.boolean().describe("这轮是否需要写回人物记忆。"),
  displayName: z.string().min(1).describe("这次写回后的人物显示名。"),
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
  issues: z.array(z.string().min(1)).optional().describe("未通过时需要修正的问题列表。"),
});

const listItemPattern = /^\s*(?:[-*]|\d+\.)\s+/;
const tableRowPattern = /^\s*\|/;
const nestedHeadingPattern = /^\s*#{1,6}\s+/;

export class PersonMemoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonMemoryFormatError";
  }
}

export async function getPersonMemoryDirectoryPath(): Promise<string> {
  const directoryPath = resolve(getYuijuConfig().app.memoryDir, "people");

  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new Error(`人物记忆目录路径不是目录：${directoryPath}`);
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }

    await mkdir(directoryPath, { recursive: true });
  }

  return directoryPath;
}

export async function getPersonMemoryFilePath(personId: string): Promise<string> {
  return resolve(await getPersonMemoryDirectoryPath(), `${personId}.json`);
}

export function parsePersonMemoryJson(input: {
  content: string;
  personId: string;
}): PersonMemoryDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    throw new PersonMemoryFormatError("人物记忆文件不是合法 JSON。");
  }

  const parsedResult = personMemoryDocumentSchema.safeParse(parsed);
  if (!parsedResult.success) {
    throw new PersonMemoryFormatError("人物记忆 JSON 对象结构不合法。");
  }

  const document = parsedResult.data;

  if (document.personId !== input.personId) {
    throw new PersonMemoryFormatError("人物记忆文件中的 personId 与文件名不一致。");
  }

  if (!dayjs(document.lastUpdatedAt).isValid()) {
    throw new PersonMemoryFormatError("人物记忆文件中的 lastUpdatedAt 不是合法时间。");
  }

  for (const section of PERSON_MEMORY_SECTION_KEYS) {
    assertValidSectionContent(section, document.sections[section]);
  }

  return {
    personId: document.personId,
    lastUpdatedAt: document.lastUpdatedAt.trim(),
    sections: PERSON_MEMORY_SECTION_KEYS.reduce(
      (result, section) => {
        result[section] = normalizeSectionContent(document.sections[section]);
        return result;
      },
      {} as Record<PersonMemorySectionKey, string>,
    ),
  };
}

export async function listPersonMemories(): Promise<PersonMemoryDirectoryItem[]> {
  const rootDir = await getPersonMemoryDirectoryPath();
  const filenames = await readdir(rootDir);

  const entries: PersonMemoryDirectoryItem[] = [];

  for (const filename of filenames.sort()) {
    if (!filename.endsWith(".json")) {
      continue;
    }

    const personId = filename.slice(0, -5);

    try {
      const content = await readFile(resolve(rootDir, filename), "utf8");
      const document = parsePersonMemoryJson({
        content,
        personId,
      });

      entries.push({
        personId,
        displayName: document.sections["称呼"],
        appellation: document.sections["称呼"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[person-memory] 跳过非法人物记忆文件 ${filename}: ${message}`);
    }
  }

  return entries;
}

export async function getPersonMemory(personId: string): Promise<PersonMemoryContentResult | null> {
  const filePath = await getPersonMemoryFilePath(personId);
  let content: string;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  const memory = parsePersonMemoryJson({
    content,
    personId,
  });

  return {
    personId,
    displayName: memory.sections["称呼"],
    memory,
  };
}

export async function updatePersonMemory(
  input: PersonMemoryUpdateInput,
): Promise<PersonMemoryUpdateResult> {
  const filePath = await getPersonMemoryFilePath(input.personId);
  let existingMemory: PersonMemoryDocument | null = null;

  try {
    const content = await readFile(filePath, "utf8");
    existingMemory = parsePersonMemoryJson({
      content,
      personId: input.personId,
    });
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
    personId: input.personId,
    scene: input.scene,
    displayName: input.displayName,
    interactionMaterial: input.interactionMaterial,
    existingMemory: existingMemory ?? undefined,
  });

  if (!proposal) {
    return {
      status: "skipped",
    };
  }

  if (!proposal.shouldUpdate) {
    return {
      status: "skipped",
    };
  }

  const nextMemory = applyProposalToDocument({
    personId: input.personId,
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
  const { output } = await generateStructuredOutput({
    model: qwen3Model,
    providerOptions: {
      Siliconflow: {
        enable_thinking: false,
      },
    },
    tools: {
      reviewPersonMemoryProposal: reviewPersonMemoryProposalTool({
        personId: input.personId,
        scene: input.scene,
        interactionMaterial: input.interactionMaterial,
        existingMemory: input.existingMemory,
      }),
    },
    output: Output.object({
      schema: personMemoryProposalSchema,
    }),
    prompt: buildPersonMemoryProposalPrompt({
      personId: input.personId,
      scene: input.scene,
      displayName: input.displayName,
      interactionMaterial: input.interactionMaterial,
      existingMemoryText: input.existingMemory
        ? JSON.stringify(input.existingMemory, null, 2)
        : "（无，当前尚未建立人物记忆）",
      sectionKeys: PERSON_MEMORY_SECTION_KEYS,
    }),
    stopWhen: stepCountIs(20),
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
        model: qwen3Model,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
        output: Output.object({
          schema: personMemoryReviewSchema,
        }),
        prompt: buildPersonMemoryReviewPrompt({
          personId: input.personId,
          scene: input.scene,
          interactionMaterial: input.interactionMaterial,
          existingMemoryText: input.existingMemory
            ? JSON.stringify(input.existingMemory, null, 2)
            : "（无，当前尚未建立人物记忆）",
          proposalJson: JSON.stringify(normalizedProposal, null, 2),
        }),
      });

      const issues = output.issues?.map((item) => item.trim()).filter((item) => item.length > 0);

      console.log("[person-memory] review", proposal, output);

      return {
        approved: output.approved,
        reason: output.reason.trim(),
        issues: issues?.length ? issues : undefined,
      };
    },
  });
}

function applyProposalToDocument(input: {
  personId: string;
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

  if (!input.existingMemory && !input.proposal.changes.some((item) => item.section === "称呼")) {
    sections["称呼"] = normalizeSectionContent(input.proposal.displayName);
  }

  for (const section of PERSON_MEMORY_SECTION_KEYS) {
    sections[section] = normalizeSectionContent(sections[section]);
    assertValidSectionContent(section, sections[section]);
  }

  return {
    personId: input.personId,
    lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
    sections,
  };
}

function normalizeProposal(
  output: z.infer<typeof personMemoryProposalSchema>,
): PersonMemoryProposal {
  return {
    shouldUpdate: output.shouldUpdate,
    displayName: output.displayName.trim(),
    changes: output.changes.map((change) => ({
      section: change.section,
      content: normalizeSectionContent(change.content),
      reason: change.reason.trim(),
    })),
  };
}

function normalizeSectionContent(content: string): string {
  const trimmed = content.replaceAll("\r\n", "\n").trim();
  return trimmed || EMPTY_PERSON_MEMORY_SECTION;
}

function assertValidSectionContent(section: PersonMemorySectionKey, content: string) {
  if (!content.trim()) {
    throw new PersonMemoryFormatError(`人物记忆字段「${section}」内容不能为空。`);
  }

  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    if (nestedHeadingPattern.test(trimmedLine)) {
      throw new PersonMemoryFormatError(`人物记忆字段「${section}」内容不能包含额外标题。`);
    }

    if (listItemPattern.test(trimmedLine)) {
      throw new PersonMemoryFormatError(`人物记忆字段「${section}」内容不能使用列表格式。`);
    }

    if (tableRowPattern.test(trimmedLine)) {
      throw new PersonMemoryFormatError(`人物记忆字段「${section}」内容不能使用表格格式。`);
    }
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function isPersonMemorySectionKey(value: string): value is PersonMemorySectionKey {
  return PERSON_MEMORY_SECTION_KEYS.includes(value as PersonMemorySectionKey);
}
