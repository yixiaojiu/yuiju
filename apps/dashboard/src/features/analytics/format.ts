const tokenNumberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  useGrouping: false,
});

export const compressionSceneLabels = { main: "主 agent", planner: "Planner", replyer: "Replyer" };

/** 占用率保留两位小数，便于观察按消息条数提前压缩的低占用场景。 */
export function formatContextRatio(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** 按千进位显示 k/m/b/t，最多两位小数；缺失用量与零消耗分开显示。 */
export function formatTokens(value: number | null): string {
  return value === null ? "—" : tokenNumberFormat.format(value).toLowerCase();
}
