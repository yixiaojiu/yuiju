const maxToolOutputChars = 5_000;
const omissionMarker = "\n……[输出过长，中间内容已省略，以下接续末尾内容]……\n";

/** 限制模型可见的查询文本，首尾均分字符预算；包含省略标记，按 Unicode 码点计数。 */
export function truncateToolOutput(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= maxToolOutputChars) {
    return text;
  }
  const contentBudget = maxToolOutputChars - Array.from(omissionMarker).length;
  const headLength = Math.floor(contentBudget / 2);
  const tailLength = contentBudget - headLength;
  return (
    characters.slice(0, headLength).join("") +
    omissionMarker +
    characters.slice(-tailLength).join("")
  );
}
