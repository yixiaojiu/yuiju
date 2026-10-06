/** 模型使用实际平台名称；OneBot 是内部接入标识，其他平台名称保持原样。 */
export function formatLlmPlatform(platform: string): string {
  return platform === "onebot" ? "QQ" : platform;
}

/** 只转换记忆输入的 platform 字段，不改写正文、来源 ID 或持久化数据。 */
export function stringifyLlmMemory(value: unknown): string {
  return JSON.stringify(value, (key, entry) =>
    key === "platform" ? formatLlmPlatform(entry) : entry,
  );
}
