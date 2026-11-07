/** 消费已知的单括号表情标签，保留未知括号文字；不回复标记仍使用双括号。 */
export function parseStickerReply(
  content: string,
  availableTags: readonly string[],
): { text: string; tag?: string } {
  let tag: string | undefined;
  const text = content
    .replaceAll("[[NO_REPLY]]", "")
    // 不从旧的 [[标签]] 中提取内层标签，也不匹配全角、残缺或跨行括号。
    .replace(/(?<!\[)\[([^[\]\r\n]+)\](?!\])/g, (fragment, label: string) => {
      if (label === "NO_REPLY" || !availableTags.includes(label)) {
        return fragment;
      }
      tag ??= label;
      return "";
    })
    .trim();
  return tag === undefined ? { text } : { text, tag };
}
