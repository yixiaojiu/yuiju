import { readFile, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { load_config } from "@yuiju/shared/config/load";
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
import { lockMemoryFile, memoryPath, writeMemoryFile } from "./files";
import {
  initializePeopleActivity,
  readPeopleActivity,
  recordPersonActivity,
  writePeopleActivity,
} from "./people-activity";

dayjs.extend(utc);
dayjs.extend(timezone);

export type PersonIdentity = { platform: string; userId: string };
/** Planner 提交意图，程序附带真实原文；生成和审查共用这份依据。 */
export type PersonMemoryInput = {
  description: string;
  messages: { date: string; text: string }[];
};
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
type ProfileContext = {
  person: PersonIdentity & { name: string };
  currentDate: string;
  previous: ProfileContent | null;
  linked: PersonProfile[];
  material: PersonMemoryInput | null;
};

/** 只更新指定人物；原文不从 Planner 描述中推导，超出输入预算直接返回失败。 */
async function reviewPersonProfile(
  characterId: string,
  person: PersonIdentity & { name: string },
  material: PersonMemoryInput | null,
  signal?: AbortSignal,
): Promise<ProfileDecision> {
  const profiles = await readPeople(characterId, person);
  const own = profiles.find(
    (profile) => profile.platform === person.platform && profile.userId === person.userId,
  );
  const config = await load_config();
  const context: ProfileContext = {
    person: { platform: person.platform, userId: person.userId, name: person.name },
    currentDate: dayjs().tz(config.app!.timezone!).format("YYYY-MM-DD"),
    previous: own ? { facts: own.facts, impressions: own.impressions } : null,
    linked: profiles.filter((profile) => profile !== own),
    material,
  };
  const persona = await renderPrompt(`character.persona.${characterId}`);
  return await reviewProfile(
    context,
    {
      update: `${persona}\n\n${await renderPrompt("memory.people")}`,
      review: `${persona}\n\n${await renderPrompt("memory.peopleReview")}`,
    },
    config.llm!.models!.strong!.context_window_tokens! * 0.8,
    signal,
  );
}

/** 更新和审查使用同一份依据，每批最多三轮；每次调用前检查完整输入。 */
async function reviewProfile(
  context: ProfileContext,
  instructions: { update: string; review: string },
  inputBudget: number,
  signal?: AbortSignal,
): Promise<ProfileDecision> {
  let candidate: ProfileContent | null = null;
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt: string = stringifyLlmMemory({ ...context, candidate, issues });
    // 沿用记忆整理的字节预算估算，同时计入人设、旧画像、候选、意见和输出 schema。
    if (
      Buffer.byteLength(
        instructions.update + prompt + JSON.stringify(z.toJSONSchema(profileContentSchema)),
        "utf8",
      ) >= inputBudget
    ) {
      throw new Error("人物画像更新请求超过整理输入预算");
    }
    const result = await generateStructuredOutput({
      model: strongModel,
      instructions: instructions.update,
      prompt,
      output: Output.object({ schema: profileContentSchema }),
      abortSignal: signal,
    });
    if (result.finishReason !== "stop") {
      throw new Error("人物画像未完整生成", {
        cause: {
          finishReason: result.finishReason,
          rawFinishReason: result.rawFinishReason,
          model: result.finalStep.response.modelId,
        },
      });
    }
    candidate = {
      facts: result.output.facts.trim(),
      impressions: result.output.impressions.trim(),
    };
    if (!context.previous && !candidate.facts && !candidate.impressions) {
      return { approved: true, content: null };
    }
    // 格式问题与审查意见一样交回更新 agent 修正，不由程序猜测或补齐正文。
    try {
      const entries = [
        ...profileEntries(candidate.facts),
        ...profileEntries(candidate.impressions),
      ];
      if (entries.some((entry) => entry.date > context.currentDate)) {
        throw new Error("认识日期不能晚于当前日期");
      }
    } catch (error) {
      issues = [error instanceof Error ? error.message : String(error)];
      continue;
    }
    const reviewPrompt = stringifyLlmMemory({ ...context, candidate });
    if (
      Buffer.byteLength(
        instructions.review + reviewPrompt + JSON.stringify(z.toJSONSchema(reviewSchema)),
        "utf8",
      ) >= inputBudget
    ) {
      throw new Error("人物画像审查请求超过整理输入预算");
    }
    const review = await generateStructuredOutput({
      model: strongModel,
      instructions: instructions.review,
      prompt: reviewPrompt,
      output: Output.object({ schema: reviewSchema }),
      abortSignal: signal,
    });
    if (review.finishReason !== "stop") {
      throw new Error("人物画像审查未完整生成", {
        cause: {
          finishReason: review.finishReason,
          rawFinishReason: review.rawFinishReason,
          model: review.finalStep.response.modelId,
        },
      });
    }
    if (review.output.approved) {
      return { approved: true, content: candidate };
    }
    issues = review.output.issues;
  }
  logger.warn("人物画像三轮审查未通过，保留旧画像", { person: context.person.name, issues });
  return { approved: false, content: null };
}

/** 调用方持有人物文件锁；更新与定期清理共用审查、保存及审查时间记录。 */
async function saveReviewedProfile(
  characterId: string,
  person: PersonIdentity & { name: string; lastSpokeAt: number },
  material: PersonMemoryInput | null,
  signal?: AbortSignal,
): Promise<"updated" | "unchanged" | "rejected"> {
  const decision = await reviewPersonProfile(characterId, person, material, signal);
  if (!decision.approved) {
    return "rejected";
  }
  const previous = await readProfile(characterId, person);
  let changed = false;
  if (decision.content !== null) {
    const profile: PersonProfile = {
      platform: person.platform,
      userId: person.userId,
      name: person.name,
      ...decision.content,
    };
    changed = !isDeepStrictEqual(previous, profile);
    if (changed) {
      await writeMemoryFile(await profilePath(characterId, person), profile);
    }
  }
  await recordPersonActivity(characterId, person, Date.now());
  return changed ? "updated" : "unchanged";
}

/** 即时更新单人画像，失败由工具返回给 Planner，不保留重试任务。 */
export async function updatePersonMemory(
  characterId: string,
  person: PersonIdentity & { name: string; lastSpokeAt: number },
  material: PersonMemoryInput,
  signal?: AbortSignal,
): Promise<"updated" | "unchanged" | "rejected"> {
  const release = await lockMemoryFile(await profilePath(characterId, person));
  try {
    signal?.throwIfAborted();
    await recordPersonActivity(characterId, person);
    // 其他群可能已经提供更晚的昵称，使用登记后的最新身份。
    const activity = await readPeopleActivity(characterId);
    const current = activity.people.find(
      (entry) => entry.platform === person.platform && entry.userId === person.userId,
    )!;
    return await saveReviewedProfile(characterId, current, material, signal);
  } finally {
    release();
  }
}

/** 删除前在人物锁内重新核对活跃情况，不能用旧快照覆盖刚发生的即时更新。 */
export async function pruneInactivePeople(characterId: string): Promise<void> {
  const candidates = await readPeopleActivity(characterId);
  for (const person of candidates.people) {
    const releaseProfile = await lockMemoryFile(await profilePath(characterId, person));
    try {
      const releaseActivity = await lockMemoryFile(
        await memoryPath(characterId, "people", "activity.json"),
      );
      try {
        const activity = await readPeopleActivity(characterId);
        const current = activity.people.find(
          (entry) => entry.platform === person.platform && entry.userId === person.userId,
        )!;
        const inactiveDays = (Date.now() - current.lastSpokeAt) / 86_400_000;
        if (current.heat - inactiveDays >= -30) {
          continue;
        }
        await rm(await profilePath(characterId, person), { force: true });
        activity.people = activity.people.filter((entry) => entry !== current);
        await writePeopleActivity(characterId, activity);
      } finally {
        releaseActivity();
      }
    } finally {
      releaseProfile();
    }
  }
}

/** 仅清理新达到两个月的条目；与即时更新共用人物锁，不用旧画像覆盖新认识。 */
export async function forgetPeople(characterId: string, signal: AbortSignal): Promise<void> {
  const candidates = await readPeopleActivity(characterId);
  const timezone = (await load_config()).app!.timezone!;
  const cutoff = dayjs().tz(timezone).subtract(2, "month").format("YYYY-MM-DD");
  for (const person of candidates.people) {
    const release = await lockMemoryFile(await profilePath(characterId, person));
    try {
      signal.throwIfAborted();
      const activity = await readPeopleActivity(characterId);
      const current = activity.people.find(
        (entry) => entry.platform === person.platform && entry.userId === person.userId,
      )!;
      const profile = await readProfile(characterId, person);
      if (!profile) {
        continue;
      }
      const previousCutoff =
        current.lastReviewedAt === null
          ? ""
          : dayjs(current.lastReviewedAt).tz(timezone).subtract(2, "month").format("YYYY-MM-DD");
      if (
        [...profileEntries(profile.facts), ...profileEntries(profile.impressions)].some(
          (entry) => entry.date > previousCutoff && entry.date <= cutoff,
        )
      ) {
        await saveReviewedProfile(characterId, current, null, signal);
      }
    } catch (error) {
      signal.throwIfAborted();
      logger.warn("人物画像清理失败，本次跳过并保留旧画像", { person: person.name, error });
    } finally {
      release();
    }
  }
}
