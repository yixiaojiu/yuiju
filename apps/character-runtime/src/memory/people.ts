import { readFile, rm } from "node:fs/promises";
import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { strongModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { formatLlmPlatform, stringifyLlmMemory } from "../conversation/platform";
import { characterKey } from "../storage";
import type { ExperienceMaterial } from "./experiences";
import { memoryPath, writeMemoryFile } from "./files";
import {
  initializePeopleActivity,
  readPeopleActivity,
  writePeopleActivity,
} from "./people-activity";

dayjs.extend(utc);
dayjs.extend(timezone);

export type PersonIdentity = { platform: string; userId: string };
const identitySchema = z.strictObject({ platform: z.string().min(1), userId: z.string().min(1) });
const linksSchema = z.array(z.array(identitySchema).min(2));
/** 模型只生成两段认识正文；身份和昵称由程序维护。 */
const profileContentSchema = z.strictObject({
  facts: z.string().describe("你知道的事实，每条使用 - YYYY-MM-DD：正文；没有内容时为空字符串。"),
  impressions: z
    .string()
    .describe("你的认识与关系感受，每条使用 - YYYY-MM-DD：正文；没有内容时为空字符串。"),
});
type ProfileContent = z.infer<typeof profileContentSchema>;
const profileSchema = identitySchema.extend({ name: z.string(), ...profileContentSchema.shape });
export type PersonProfile = z.infer<typeof profileSchema>;
const reviewSchema = z.strictObject({
  approved: z.boolean().describe("这份完整画像是否可以保存。"),
  issues: z.array(z.string()).describe("需要修正的具体问题；通过时为空数组。"),
});

async function profilePath(characterId: string, identity: PersonIdentity): Promise<string> {
  return await memoryPath(
    characterId,
    "people",
    encodeURIComponent(identity.platform).replaceAll(".", "%2E"),
    `${encodeURIComponent(identity.userId).replaceAll(".", "%2E")}.json`,
  );
}

async function readProfile(
  characterId: string,
  identity: PersonIdentity,
): Promise<PersonProfile | null> {
  try {
    return profileSchema.parse(
      JSON.parse(await readFile(await profilePath(characterId, identity), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** 分别检查两个文本字段的条目日期和容量，不再解析姓名或 Markdown 栏目标题。 */
function profileEntries(text: string): { date: string; text: string }[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 20) {
    throw new Error("画像每个字段最多 20 条记忆");
  }
  return lines.map((line) => {
    const match = /^- (\d{4}-\d{2}-\d{2})：(\S.*)$/.exec(line);
    if (!match) {
      throw new Error("画像条目格式为 - YYYY-MM-DD：正文，不包含标题");
    }
    z.iso.date().parse(match[1]);
    if ([...match[2]].length > 400) {
      throw new Error("画像每条正文最多 400 字");
    }
    return { date: match[1], text: match[2] };
  });
}

export async function initializePeople(characterId: string): Promise<void> {
  const path = await memoryPath(characterId, "people", "links.json");
  try {
    linksSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    await writeMemoryFile(path, []);
  }
  await initializePeopleActivity(characterId);
}

/** 同一平台身份跨群共用；跨平台仅按手动关联联合读取，不推断或合并身份。 */
export async function readPeople(
  characterId: string,
  identity: PersonIdentity,
): Promise<PersonProfile[]> {
  const links = linksSchema.parse(
    JSON.parse(await readFile(await memoryPath(characterId, "people", "links.json"), "utf8")),
  );
  const group = links.find((identities) =>
    identities.some(
      (item) => item.platform === identity.platform && item.userId === identity.userId,
    ),
  );
  const profiles = await Promise.all(
    (group ?? [identity]).map((item) => readProfile(characterId, item)),
  );
  return profiles.filter((profile): profile is PersonProfile => profile !== null);
}

export function formatPeople(profiles: PersonProfile[]): string {
  return (
    profiles
      .map((profile) =>
        [
          `${profile.name}（${formatLlmPlatform(profile.platform)} / ${profile.userId}）`,
          `我知道的事：\n${profile.facts}`,
          `我的认识与关系感受：\n${profile.impressions}`,
        ].join("\n"),
      )
      .join("\n\n") || "没有当前可用的人物认识；这不代表第一次相识。"
  );
}

type ProfileDecision = { approved: boolean; content: ProfileContent | null };
/** 已通过审查的两个字段先保存在每日任务中；文件写入中断后重放同一份内容。 */
type PeopleUpdateProgress = {
  taskId: string;
  people: (PersonIdentity & { name: string })[];
  index: number;
  decision: ProfileDecision | null;
};

/** 程序控制三轮修改与审查，审查 agent 只能给结论，不能修改待写入的文本。 */
async function reviewPersonProfile(
  characterId: string,
  person: PersonIdentity & { name: string },
  materials: ExperienceMaterial[],
  signal: AbortSignal,
): Promise<ProfileDecision> {
  const profiles = await readPeople(characterId, person);
  const own = profiles.find(
    (profile) => profile.platform === person.platform && profile.userId === person.userId,
  );
  const currentDate = dayjs()
    .tz((await load_config()).app!.timezone!)
    .format("YYYY-MM-DD");
  const context = {
    person,
    currentDate,
    previous: own ? { facts: own.facts, impressions: own.impressions } : null,
    linked: profiles.filter((profile) => profile !== own),
    conversations: materials.map((material) => ({
      ...material.conversation,
      content: material.content,
    })),
  };
  const persona = await renderPrompt(`character.persona.${characterId}`);
  const instructions = `${persona}\n\n${await renderPrompt("memory.people")}`;
  const reviewInstructions = `${persona}\n\n${await renderPrompt("memory.peopleReview")}`;
  let candidate: ProfileContent | null = null;
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt: string = stringifyLlmMemory({ ...context, candidate, issues });
    const result = await generateStructuredOutput({
      model: strongModel,
      instructions,
      prompt,
      output: Output.object({ schema: profileContentSchema }),
      abortSignal: signal,
    });
    if (result.finishReason !== "stop") {
      throw new Error("人物画像未完整生成，保留旧画像及任务进度");
    }
    candidate = {
      facts: result.output.facts.trim(),
      impressions: result.output.impressions.trim(),
    };
    if (!own && !candidate.facts && !candidate.impressions) {
      return { approved: true, content: null };
    }
    // 格式问题与审查意见一样交回更新 agent 修正，不由程序猜测或补齐正文。
    try {
      const entries = [
        ...profileEntries(candidate.facts),
        ...profileEntries(candidate.impressions),
      ];
      if (entries.some((entry) => entry.date > currentDate)) {
        throw new Error("认识日期不能晚于当前日期");
      }
    } catch (error) {
      issues = [error instanceof Error ? error.message : String(error)];
      continue;
    }
    const review = await generateStructuredOutput({
      model: strongModel,
      instructions: reviewInstructions,
      prompt: stringifyLlmMemory({ ...context, candidate }),
      output: Output.object({ schema: reviewSchema }),
      abortSignal: signal,
    });
    if (review.output.approved) {
      return { approved: true, content: candidate };
    }
    issues = review.output.issues;
  }
  logger.warn("人物画像三轮审查未通过，保留旧画像", { issues });
  return { approved: false, content: null };
}

/** 更新与无新交流时的内容清理共用同一套审查、写入及恢复流程。 */
async function updateProfiles(
  characterId: string,
  taskId: string,
  people: PeopleUpdateProgress["people"],
  materials: ExperienceMaterial[],
  signal: AbortSignal,
): Promise<void> {
  const redis = await getRedis();
  const key = `${characterKey(characterId)}:memory:daily:people`;
  const stored = await redis.get(key);
  let progress: PeopleUpdateProgress | null = stored === null ? null : JSON.parse(stored);
  if (progress?.taskId !== taskId) {
    progress = { taskId, people, index: 0, decision: null };
    await redis.set(key, JSON.stringify(progress));
  }
  while (progress.index < progress.people.length) {
    signal.throwIfAborted();
    const person = progress.people[progress.index];
    if (progress.decision === null) {
      // 带上这个人出现过的群在本批的完整交流，保留悠乃回复与其他人的上下文。
      const channels = new Set(
        materials
          .filter((material) =>
            material.people.some(
              (item) => item.platform === person.platform && item.userId === person.userId,
            ),
          )
          .map((material) => JSON.stringify(material.conversation)),
      );
      const related = materials.filter(
        (material) => material.conversation && channels.has(JSON.stringify(material.conversation)),
      );
      progress.decision = await reviewPersonProfile(characterId, person, related, signal);
      await redis.set(key, JSON.stringify(progress));
    }
    if (progress.decision.approved && progress.decision.content !== null) {
      await writeMemoryFile(await profilePath(characterId, person), {
        ...person,
        ...progress.decision.content,
      } satisfies PersonProfile);
    } else {
      // 昵称是平台事实，即使本轮内容未更新或被驳回，也不由模型决定是否同步。
      const previous = await readProfile(characterId, person);
      if (previous && previous.name !== person.name) {
        await writeMemoryFile(await profilePath(characterId, person), {
          ...previous,
          name: person.name,
        });
      }
    }
    if (progress.decision.approved) {
      const activity = await readPeopleActivity(characterId);
      const entry = activity.people.find(
        (item) => item.platform === person.platform && item.userId === person.userId,
      )!;
      entry.lastReviewedAt = Date.now();
      await writePeopleActivity(characterId, activity);
    }
    progress.index += 1;
    progress.decision = null;
    await redis.set(key, JSON.stringify(progress));
  }
}

export async function organizePeople(
  characterId: string,
  batchId: string,
  materials: ExperienceMaterial[],
  signal: AbortSignal,
): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  const identities = new Map(
    materials
      .flatMap((material) => material.people)
      .map((person) => [JSON.stringify([person.platform, person.userId]), person]),
  );
  // 使用活跃统计按真实消息时间维护的最新昵称，旧批次不能将其覆盖回旧昵称。
  const people = activity.people
    .filter((person) => identities.has(JSON.stringify([person.platform, person.userId])))
    .map(({ platform, userId, name }) => ({ platform, userId, name }));
  await updateProfiles(characterId, batchId, people, materials, signal);
}

/** 每日进入模型整理前执行；无新消息也清理，热度和真实最后发言时间由程序决定。 */
export async function pruneInactivePeople(characterId: string): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  for (const person of [...activity.people]) {
    const inactiveDays = (Date.now() - person.lastSpokeAt) / 86_400_000;
    if (person.heat - inactiveDays >= -30) {
      continue;
    }
    // 先删画像再提交统计；中途重启允许重复删除，也涵盖从未建立画像的发言者。
    await rm(await profilePath(characterId, person), { force: true });
    activity.people = activity.people.filter((item) => item !== person);
    await writePeopleActivity(characterId, activity);
  }
}

/** 仅让新达到两个月的条目进入内容清理；稳定认识经审查保留后不必每天重写。 */
export async function forgetPeople(
  characterId: string,
  date: string,
  signal: AbortSignal,
): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  const timezone = (await load_config()).app!.timezone!;
  const cutoff = dayjs().tz(timezone).subtract(2, "month").format("YYYY-MM-DD");
  const people: PeopleUpdateProgress["people"] = [];
  for (const person of activity.people) {
    const profile = await readProfile(characterId, person);
    if (!profile) {
      continue;
    }
    const previousCutoff =
      person.lastReviewedAt === null
        ? ""
        : dayjs(person.lastReviewedAt).tz(timezone).subtract(2, "month").format("YYYY-MM-DD");
    if (
      [...profileEntries(profile.facts), ...profileEntries(profile.impressions)].some(
        (entry) => entry.date > previousCutoff && entry.date <= cutoff,
      )
    ) {
      people.push({ platform: person.platform, userId: person.userId, name: person.name });
    }
  }
  await updateProfiles(characterId, `cleanup:${date}`, people, [], signal);
}
