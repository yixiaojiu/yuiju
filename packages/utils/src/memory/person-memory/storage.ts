import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import dayjs from "dayjs";
import { z } from "zod";
import { getYuijuConfig } from "../../config/config";
import { normalizeSectionContent, PersonMemoryFormatError } from "./format";
import {
  PERSON_MEMORY_SECTION_KEYS,
  type PersonMemoryContentResult,
  type PersonMemoryDocument,
  type PersonMemorySectionKey,
} from "./types";

const personMemoryDocumentSchema = z.object({
  nickname: z.string().min(1),
  lastUpdatedAt: z.string().min(1),
  sections: z.record(z.string(), z.unknown()).nullish(),
});

const unsafePersonMemoryFilenameChars = new Set([
  "%",
  "/",
  "\\",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

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

export async function getPersonMemoryFilePath(nickname: string): Promise<string> {
  return resolve(
    await getPersonMemoryDirectoryPath(),
    `${encodePersonMemoryFilename(nickname)}.json`,
  );
}

export function parsePersonMemoryJson(content: string): PersonMemoryDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PersonMemoryFormatError("人物记忆文件不是合法 JSON。");
  }

  const parsedResult = personMemoryDocumentSchema.safeParse(parsed);
  if (!parsedResult.success) {
    throw new PersonMemoryFormatError("人物记忆 JSON 对象结构不合法。");
  }

  const document = parsedResult.data;

  if (!dayjs(document.lastUpdatedAt).isValid()) {
    throw new PersonMemoryFormatError("人物记忆文件中的 lastUpdatedAt 不是合法时间。");
  }

  return {
    nickname: document.nickname,
    lastUpdatedAt: document.lastUpdatedAt.trim(),
    sections: PERSON_MEMORY_SECTION_KEYS.reduce(
      (result, section) => {
        const content = document.sections?.[section];
        result[section] = normalizeSectionContent(typeof content === "string" ? content : "");
        return result;
      },
      {} as Record<PersonMemorySectionKey, string>,
    ),
  };
}

export async function getPersonMemory(nickname: string): Promise<PersonMemoryContentResult | null> {
  const filePath = await getPersonMemoryFilePath(nickname);
  let content: string;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  const memory = parsePersonMemoryJson(content);

  return {
    nickname: memory.nickname,
    sections: memory.sections,
  };
}

export function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function encodePersonMemoryFilename(nickname: string): string {
  let filename = "";

  for (const char of nickname) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 31 ||
      codePoint === 127 ||
      unsafePersonMemoryFilenameChars.has(char)
    ) {
      filename += `%${(codePoint ?? 0).toString(16).toUpperCase().padStart(2, "0")}`;
      continue;
    }

    filename += char;
  }

  return filename;
}
