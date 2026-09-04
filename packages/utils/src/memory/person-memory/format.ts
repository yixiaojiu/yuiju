import {
  EMPTY_PERSON_MEMORY_SECTION,
  PERSON_MEMORY_SECTION_KEYS,
  type PersonMemorySectionKey,
} from "./types";

export class PersonMemoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonMemoryFormatError";
  }
}

export function normalizeSectionContent(content: string): string {
  const trimmed = content.replaceAll("\r\n", "\n").trim();
  return trimmed || EMPTY_PERSON_MEMORY_SECTION;
}

export function isPersonMemorySectionKey(value: string): value is PersonMemorySectionKey {
  return PERSON_MEMORY_SECTION_KEYS.includes(value as PersonMemorySectionKey);
}
