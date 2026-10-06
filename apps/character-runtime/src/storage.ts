import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import type { ChainableCommander } from "ioredis";

/** 所有角色业务存储共用身份前缀，模块各自维护字段，不保存整份 Character。 */
export function characterKey(characterId: string): string {
  return `${redisKeyPrefix()}character:${encodeURIComponent(characterId)}`;
}

/** Redis MULTI 的逐条命令错误也必须传播，调用方不能发布未确认的内存状态。 */
export async function commitCharacterTransaction(transaction: ChainableCommander): Promise<void> {
  const results = await transaction.exec();
  if (results === null) {
    throw new Error("角色状态事务未执行");
  }
  for (const [error] of results) {
    if (error) {
      throw error;
    }
  }
}
