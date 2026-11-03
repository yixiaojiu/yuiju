/** 清理所有表情控制片段，仅保留第一个完整且可用的标签。 */
export function parseStickerReply(
  content: string,
  availableTags: readonly string[],
): { text: string; tag?: string } {
  let tag: string | undefined;
  // 残缺片段清理到右括号、下一个左括号或行尾，不跨行吞掉正文。
  const text = content
    .replace(/\[{2,}[^[\]\r\n]*(?:\]+|(?=\[|\r|\n|$))|\]{2,}/g, (fragment) => {
      const match = /^\[\[([^[\]\r\n]+)\]\]$/.exec(fragment);
      if (
        tag === undefined &&
        match &&
        match[1] !== "NO_REPLY" &&
        availableTags.includes(match[1])
      ) {
        tag = match[1];
      }
      return "";
    })
    .trim();
  return tag === undefined ? { text } : { text, tag };
}
