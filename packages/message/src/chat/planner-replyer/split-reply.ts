const SHORT_REPLY_MAX_LENGTH = 24;
const WEAK_BOUNDARY_MIN_FRAGMENT_LENGTH = 18;
const MIN_STANDALONE_FRAGMENT_LENGTH = 4;
const MAX_SEGMENTS = 3;

const URL_PATTERN = /https?:\/\/[^\s。！？；，、“”‘’]+/g;
const PROTECTED_TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9._:/?#[\]@!$&'()*+,;=%-]*/g;

export function splitChatReply(text: string): string[] {
  const normalized = text.trim();
  if (!normalized || (normalized.length <= SHORT_REPLY_MAX_LENGTH && !normalized.includes("\n"))) {
    return normalized ? [normalized] : [];
  }

  const protectedIndexes = new Set<number>();
  protectMatches(normalized, URL_PATTERN, protectedIndexes);
  protectMatches(normalized, PROTECTED_TOKEN_PATTERN, protectedIndexes);
  protectQuotedContent(normalized, protectedIndexes);

  const candidates: string[] = [];
  let start = 0;

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
