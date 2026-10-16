import { createHash, timingSafeEqual } from "node:crypto";

const bearerPrefix = "Bearer ";

/** 先摘要再比较：两侧长度一致，比较耗时不随令牌长度变化。 */
function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** HTTP 与 WebSocket 共用一份判断；未配置令牌时只可能是本机监听（配置契约已保证）。 */
export function isWorldRequestAuthorized(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (token === undefined) {
    return true;
  }
  if (header === undefined || !header.startsWith(bearerPrefix)) {
    return false;
  }
  return constantTimeEqual(header.slice(bearerPrefix.length), token);
}
