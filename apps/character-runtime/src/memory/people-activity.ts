import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ArchivedConversationMessage } from "../conversation/storage";
import { memoryPath, writeMemoryFile } from "./files";

const activitySchema = z.strictObject({
  /** 每个整理日只统计一次，失败重跑不能重复累计热度。 */
  countedDate: z.string().nullable(),
  people: z.array(
    z.strictObject({
      platform: z.string(),
      userId: z.string(),
      name: z.string(),
      heat: z.number().int().min(0).max(100),
      lastSpokeAt: z.number(),
      /** 用来检查哪些条目在上次整理之后满两个月，不改变记忆条目的日期。 */
      lastReviewedAt: z.number().nullable(),
    }),
  ),
});
export type PeopleActivity = z.infer<typeof activitySchema>;

export async function initializePeopleActivity(characterId: string): Promise<void> {
  try {
    await readPeopleActivity(characterId);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    await writePeopleActivity(characterId, { countedDate: null, people: [] });
  }
}

export async function readPeopleActivity(characterId: string): Promise<PeopleActivity> {
  return activitySchema.parse(
    JSON.parse(await readFile(await memoryPath(characterId, "people", "activity.json"), "utf8")),
  );
}

export async function writePeopleActivity(
  characterId: string,
  activity: PeopleActivity,
): Promise<void> {
  await writeMemoryFile(await memoryPath(characterId, "people", "activity.json"), activity);
}

/** 只累计他人的实际发言，戳一戳和角色回复不计数；最后活跃时间取消息时间。 */
export async function updatePeopleActivity(
  characterId: string,
  date: string,
  messages: ArchivedConversationMessage[],
): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  if (activity.countedDate === date) {
    return;
  }
  for (const message of messages) {
    if (message.isSelf || message.kind !== "message") {
      continue;
    }
    let person = activity.people.find(
      (item) => item.platform === message.platform && item.userId === message.senderId,
    );
    if (!person) {
      person = {
        platform: message.platform,
        userId: message.senderId,
        name: message.senderName,
        heat: 0,
        lastSpokeAt: message.timestamp,
        lastReviewedAt: null,
      };
      activity.people.push(person);
    }
    person.heat = Math.min(100, person.heat + 1);
    if (message.timestamp >= person.lastSpokeAt) {
      person.lastSpokeAt = message.timestamp;
      person.name = message.senderName;
    }
  }
  // 统计和去重标记写在同一份原子快照中，模型失败不回滚实际发言。
  activity.countedDate = date;
  await writePeopleActivity(characterId, activity);
}
