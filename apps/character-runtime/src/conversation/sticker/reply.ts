/** 移除单括号表情标记，只选取第一个已知标签；不回复标记仍使用双括号。 */
export function parseStickerReply(
  content: string,
  availableTags: readonly string[],
): { text: string; tag?: string } {
  let tag: string | undefined;
  const text = content
    .replaceAll("[[NO_REPLY]]", "")
    // 不从旧的 [[标签]] 中提取内层标签，也不匹配全角、残缺或跨行括号。
    .replace(/(?<!\[)\[([^[\]\r\n]+)\](?!\])/g, (_fragment, label: string) => {
      if (availableTags.includes(label)) {
        tag ??= label;
      }
      return "";
    })
    .trim();
  return tag === undefined ? { text } : { text, tag };
}
