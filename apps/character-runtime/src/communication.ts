import { getRedis } from "@yuiju/shared/database/redis";
import { z } from "zod";
import { characterKey } from "./storage";

/** 事件关联保留 30 天；原输入被消费后仍能定位来源，读取不会续期。 */
export const COMMUNICATION_RETENTION_MS = 30 * 86_400_000;

const eventFields = { id: z.string(), occurredAt: z.number(), content: z.string() };

/** 主 loop 交给单群 Planner 的输入，不属于实际发送到 QQ 的消息。 */
export const conversationAgentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...eventFields, type: z.literal("share") }),
  z.strictObject({
    ...eventFields,
    type: z.literal("result"),
    relatedEventId: z.string(),
  }),
]);
export type ConversationAgentEvent = z.infer<typeof conversationAgentEventSchema>;

const sourceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("main") }),
  z.strictObject({
    type: z.literal("conversation"),
    scope: z.strictObject({
      characterId: z.string(),
      platform: z.literal("onebot"),
      channelId: z.string(),
    }),
  }),
]);

/** 先登记来源再投递输入；重放不覆盖来源，也不延长关联期限。 */
export async function saveCommunicationSource(
  characterId: string,
  eventId: string,
  source: z.infer<typeof sourceSchema>,
  occurredAt: number,
): Promise<void> {
  await (await getRedis()).set(
    `${characterKey(characterId)}:communication:${encodeURIComponent(eventId)}`,
    JSON.stringify(source),
    "PXAT",
    occurredAt + COMMUNICATION_RETENTION_MS,
    "NX",
  );
}

/** 找不到或已过期时由工具明确返回失败，不能猜测来源群。 */
export async function readCommunicationSource(characterId: string, eventId: string) {
  const value = await (await getRedis()).get(
    `${characterKey(characterId)}:communication:${encodeURIComponent(eventId)}`,
  );
  return value === null ? null : sourceSchema.parse(JSON.parse(value));
}
