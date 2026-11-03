const SHORT_REPLY_MAX_LENGTH = 24;
const WEAK_BOUNDARY_MIN_FRAGMENT_LENGTH = 18;
const MIN_STANDALONE_FRAGMENT_LENGTH = 4;
const MAX_SEGMENTS = 3;

const URL_PATTERN = /https?:\/\/[^\s。！？；，、“”‘’]+/g;
const PROTECTED_TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9._:/?#[\]@!$&'()*+,;=%-]*/g;

/** 沿用旧应用分段规则：保护完整片段，按标点切分，再合并过短与超额的段落。 */
export function splitChatReply(text: string): string[] {
  const normalized = text.trim();
  if (!normalized || (normalized.length <= SHORT_REPLY_MAX_LENGTH && !normalized.includes("\n"))) {
    return normalized ? [normalized] : [];
  }

  // URL、英文 token 和引号中的标点不作为断句边界，避免拆坏链接或引用内容。
  const protectedIndexes = new Set<number>();
  protectMatches(normalized, URL_PATTERN, protectedIndexes);
  protectMatches(normalized, PROTECTED_TOKEN_PATTERN, protectedIndexes);
  protectQuotedContent(normalized, protectedIndexes);

  const candidates: string[] = [];
  let start = 0;

  // 强标点直接断句，逗号 / 顿号仅在片段足够长时断句；换行不保留，标点保留。
  for (let index = 0; index < normalized.length; index += 1) {
    if (protectedIndexes.has(index)) {
      continue;
    }

    const char = normalized[index];
    const fragmentLength = index - start + 1;
    const isStrongBoundary = char === "\n" || "。！？；".includes(char);
    const isWeakBoundary =
      "，、".includes(char) && fragmentLength >= WEAK_BOUNDARY_MIN_FRAGMENT_LENGTH;
    if (!isStrongBoundary && !isWeakBoundary) {
      continue;
    }

    const fragment = normalized.slice(start, char === "\n" ? index : index + 1).trim();
    if (fragment) {
      candidates.push(fragment);
    }
    start = index + 1;
  }

  const tail = normalized.slice(start).trim();
  if (tail) {
    candidates.push(tail);
  }

  // 短片段先并入前段；首段没有前段可并，循环后再并入下一段。
  const merged: string[] = [];
  for (const fragment of candidates) {
    if (fragment.length < MIN_STANDALONE_FRAGMENT_LENGTH && merged.length) {
      merged[merged.length - 1] += fragment;
      continue;
    }
    merged.push(fragment);
  }

  if (merged.length > 1 && merged[0].length < MIN_STANDALONE_FRAGMENT_LENGTH) {
    merged[1] = merged[0] + merged[1];
    merged.shift();
  }

  if (merged.length <= MAX_SEGMENTS) {
    return merged;
  }

  // 超出最大段数时合并尾部，不能截掉回复内容。
  return [...merged.slice(0, MAX_SEGMENTS - 1), merged.slice(MAX_SEGMENTS - 1).join("")];
}

function protectMatches(text: string, pattern: RegExp, protectedIndexes: Set<number>): void {
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    for (let index = start; index < start + match[0].length; index += 1) {
      protectedIndexes.add(index);
    }
  }
}

function protectQuotedContent(text: string, protectedIndexes: Set<number>): void {
  const quotePairs: Array<[string, string]> = [
    ["“", "”"],
    ["‘", "’"],
    ['"', '"'],
    ["'", "'"],
  ];

  for (const [opening, closing] of quotePairs) {
    let start = text.indexOf(opening);
    while (start >= 0) {
      const end = text.indexOf(closing, start + 1);
      if (end < 0) {
        break;
      }
      for (let index = start; index <= end; index += 1) {
        protectedIndexes.add(index);
      }
      start = text.indexOf(opening, end + 1);
    }
  }
}
