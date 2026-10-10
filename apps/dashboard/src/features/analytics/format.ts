const tokenNumberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** 按千进位显示 k/m/b/t，最多两位小数；缺失用量与零消耗分开显示。 */
export function formatTokens(value: number | null): string {
  return value === null ? "—" : tokenNumberFormat.format(value).toLowerCase();
}
