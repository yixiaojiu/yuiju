import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Output, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { getYuijuConfig } from "../config";
import { createToolCallLoggingHooks, generateStructuredOutput } from "../llm";
import { visionModel } from "../llm/models";
import { logger } from "../logger";
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
  nickname: string;
  lastUpdatedAt: string;
  sections: Record<PersonMemorySectionKey, string>;
}

export interface PersonMemoryUpdateInput {
  personId: string;
  nickname: string;
  interactionMaterial: string;
  scene: "private" | "group";
  interactionCount: number;
}

export interface PersonMemoryUpdateResult {
  status: "skipped" | "created" | "updated" | "review_rejected" | "malformed_existing_file";
}

export interface PersonMemoryDirectoryItem {
  personId: string;
  nickname: string;
}

export interface PersonMemoryDirectoryResult {
  items: PersonMemoryDirectoryItem[];
  page_number: number;
  total: number;
  hasMore: boolean;
}

export interface PersonMemoryContentResult {
  personId: string;
  nickname: string;
  sections: Record<PersonMemorySectionKey, string>;
}

export interface PersonMemoryProposalChange {
  section: PersonMemorySectionKey;
  content: string;
  reason: string;
}

export interface PersonMemoryProposal {
  shouldUpdate: boolean;
  changes: PersonMemoryProposalChange[];
}

interface PersonMemoryProposalContext {
  personId: string;
  scene: "private" | "group";
  nickname: string;
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

interface PersonMemoryHeatEntry {
  heat: number;
  lastInteractedAt: string;
}

/**
 * people/person-memory-heat.json 的结构：
 * {
 *   [personId]: {
 *     heat: 累计发言热度,
 *     lastInteractedAt: 最近一次累计热度的时间
 *   }
 * }
 */
type PersonMemoryHeatDocument = Record<string, PersonMemoryHeatEntry>;

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
  nickname: z.string().min(1),
  lastUpdatedAt: z.string().min(1),
  sections: personMemorySectionsSchema,
});

const personMemoryHeatSchema = z.record(
  z.string().min(1),
  z.strictObject({
    heat: z.number().finite().nonnegative(),
    lastInteractedAt: z.string().min(1),
  }),
);

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
  issues: z.array(z.string().min(1)).optional().describe("未通过时需要修正的问题列表。"),
});

const listItemPattern = /^\s*(?:[-*]|\d+\.)\s+/;
const tableRowPattern = /^\s*\|/;
const nestedHeadingPattern = /^\s*#{1,6}\s+/;
const PERSON_MEMORY_HEAT_FILENAME = "person-memory-heat.json";
const PERSON_MEMORY_LIST_PAGE_SIZE = 20;

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

export async function getPersonMemoryHeatFilePath(): Promise<string> {
  return resolve(await getPersonMemoryDirectoryPath(), PERSON_MEMORY_HEAT_FILENAME);
}

export async function initializePersonMemoryHeat(): Promise<void> {
  const rootDir = await getPersonMemoryDirectoryPath();
  const heatFilePath = await getPersonMemoryHeatFilePath();
  const filenames = await readdir(rootDir);
  let heatDocument: PersonMemoryHeatDocument = {};
  let shouldWriteHeatFile = false;

  try {
    const stats = await stat(heatFilePath);
    if (!stats.isFile()) {
      throw new Error(`人物记忆热度文件路径不是文件：${heatFilePath}`);
    }

    heatDocument = await readPersonMemoryHeatDocument();
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }

    shouldWriteHeatFile = true;
  }

  for (const filename of filenames.sort()) {
    if (!filename.endsWith(".json") || filename === PERSON_MEMORY_HEAT_FILENAME) {
      continue;
    }

    const personId = filename.slice(0, -5);
    if (heatDocument[personId]) {
      continue;
    }

    try {
      const content = await readFile(resolve(rootDir, filename), "utf8");
      const document = parsePersonMemoryJson({
        content,
        personId,
      });

      heatDocument[personId] = {
        heat: 0,
        lastInteractedAt: document.lastUpdatedAt,
      };
      shouldWriteHeatFile = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[person-memory] 初始化热度时跳过非法人物记忆文件 ${filename}: ${message}`);
    }
  }

  if (!shouldWriteHeatFile) {
    return;
  }

  await writeFile(heatFilePath, `${JSON.stringify(heatDocument, null, 2)}\n`, "utf8");
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
    nickname: document.nickname,
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

export async function listPersonMemories(page = 1): Promise<PersonMemoryDirectoryResult> {
  const rootDir = await getPersonMemoryDirectoryPath();
  const filenames = await readdir(rootDir);
  const heatDocument = await readPersonMemoryHeatDocument();

  const entries: PersonMemoryDirectoryItem[] = [];

  for (const filename of filenames.sort()) {
    if (!filename.endsWith(".json") || filename === PERSON_MEMORY_HEAT_FILENAME) {
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
        nickname: document.nickname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[person-memory] 跳过非法人物记忆文件 ${filename}: ${message}`);
    }
  }

  entries.sort((left, right) => {
    const leftHeat = heatDocument[left.personId]?.heat ?? 0;
    const rightHeat = heatDocument[right.personId]?.heat ?? 0;

    if (rightHeat !== leftHeat) {
      return rightHeat - leftHeat;
    }

    const leftLastInteractedAt = heatDocument[left.personId]?.lastInteractedAt;
    const rightLastInteractedAt = heatDocument[right.personId]?.lastInteractedAt;
    const leftLastInteractedAtMs = leftLastInteractedAt ? dayjs(leftLastInteractedAt).valueOf() : 0;
    const rightLastInteractedAtMs = rightLastInteractedAt
      ? dayjs(rightLastInteractedAt).valueOf()
      : 0;

    if (rightLastInteractedAtMs !== leftLastInteractedAtMs) {
      return rightLastInteractedAtMs - leftLastInteractedAtMs;
    }

    return left.personId.localeCompare(right.personId);
  });

  const pageNumber = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const startIndex = (pageNumber - 1) * PERSON_MEMORY_LIST_PAGE_SIZE;
  const items = entries.slice(startIndex, startIndex + PERSON_MEMORY_LIST_PAGE_SIZE);

  return {
    items,
    page_number: pageNumber,
    total: entries.length,
    hasMore: startIndex + PERSON_MEMORY_LIST_PAGE_SIZE < entries.length,
  };
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
    nickname: memory.nickname,
    sections: memory.sections,
  };
}

export async function updatePersonMemory(
  input: PersonMemoryUpdateInput,
): Promise<PersonMemoryUpdateResult> {
  const filePath = await getPersonMemoryFilePath(input.personId);
  let existingMemory: PersonMemoryDocument | null = null;

  await updatePersonMemoryHeat({
    personId: input.personId,
    interactionCount: input.interactionCount,
  });

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
    nickname: input.nickname,
    interactionMaterial: input.interactionMaterial,
    existingMemory: existingMemory ?? undefined,
  });

  // TODO 记录日志

  if (!proposal || !proposal.shouldUpdate) {
    if (existingMemory && existingMemory.nickname !== input.nickname) {
      await writeFile(
        filePath,
        `${JSON.stringify(
          {
            ...existingMemory,
            nickname: input.nickname,
            lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      return {
        status: "updated",
      };
    }

    return {
      status: "skipped",
    };
  }

  const nextMemory = applyProposalToDocument({
    personId: input.personId,
    nickname: input.nickname,
    existingMemory,
    proposal,
  });

  await writeFile(filePath, `${JSON.stringify(nextMemory, null, 2)}\n`, "utf8");

  return {
    status: existingMemory ? "updated" : "created",
  };
}

async function readPersonMemoryHeatDocument(): Promise<PersonMemoryHeatDocument> {
  const filePath = await getPersonMemoryHeatFilePath();
  let content: string;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PersonMemoryFormatError("人物记忆热度文件不是合法 JSON。");
  }

  const parsedResult = personMemoryHeatSchema.safeParse(parsed);
  if (!parsedResult.success) {
    throw new PersonMemoryFormatError("人物记忆热度 JSON 对象结构不合法。");
  }

  for (const [personId, item] of Object.entries(parsedResult.data)) {
    if (!dayjs(item.lastInteractedAt).isValid()) {
      throw new PersonMemoryFormatError(
        `人物记忆热度文件中 ${personId} 的 lastInteractedAt 不是合法时间。`,
      );
    }
  }

  return parsedResult.data;
}

async function updatePersonMemoryHeat(input: {
  personId: string;
  interactionCount: number;
}): Promise<void> {
  const interactionCount = Math.max(0, Math.floor(input.interactionCount));
  if (interactionCount === 0) {
    return;
  }

  const heatDocument = await readPersonMemoryHeatDocument();
  const currentHeat = heatDocument[input.personId]?.heat ?? 0;

  heatDocument[input.personId] = {
    heat: currentHeat + interactionCount,
    lastInteractedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
  };

  await writeFile(
    await getPersonMemoryHeatFilePath(),
    `${JSON.stringify(heatDocument, null, 2)}\n`,
    "utf8",
  );
}

async function generatePersonMemoryProposal(
  input: PersonMemoryProposalContext,
): Promise<PersonMemoryProposal | null> {
  const { output } = await generateStructuredOutput({
    model: visionModel,
    providerOptions: {
      vision: {
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
      nickname: input.nickname,
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
        model: visionModel,
        providerOptions: {
          vision: {
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

      logger.debug("[person-memory] review", proposal, output);

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
    assertValidSectionContent(section, sections[section]);
  }

  return {
    personId: input.personId,
    nickname: input.nickname,
    lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
    sections,
  };
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
