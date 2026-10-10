import { readFile, rm } from "node:fs/promises";
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
import { memoryPath, writeMemoryFile } from "./files";
import {
  initializePeopleActivity,
  readPeopleActivity,
  writePeopleActivity,
} from "./people-activity";

dayjs.extend(utc);
dayjs.extend(timezone);

export type PersonIdentity = { platform: string; userId: string };
/** 群聊整理提取的临时依据；日期由程序绑定，正文保留原话及语境，不直接当作画像。 */
export type PersonMemoryMaterial = PersonIdentity & { date: string; text: string };
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
  materials: { date: string; text: string }[];
};

/** 汇集整日材料；超出输入预算时按材料分批，全部通过后才提交这一人的画像。 */
async function reviewPersonProfile(
  characterId: string,
  person: PersonIdentity & { name: string },
  materials: PersonMemoryMaterial[],
  signal: AbortSignal,
): Promise<ProfileDecision> {
  const profiles = await readPeople(characterId, person);
  const own = profiles.find(
    (profile) => profile.platform === person.platform && profile.userId === person.userId,
  );
  const config = await load_config();
  const inputBudget = config.llm!.models!.strong!.context_window_tokens! * 0.8;
  const context: ProfileContext = {
    person,
    currentDate: dayjs().tz(config.app!.timezone!).format("YYYY-MM-DD"),
    previous: own ? { facts: own.facts, impressions: own.impressions } : null,
    linked: profiles.filter((profile) => profile !== own),
    materials: [],
  };
  const persona = await renderPrompt(`character.persona.${characterId}`);
  const instructions = {
    update: `${persona}\n\n${await renderPrompt("memory.people")}`,
    review: `${persona}\n\n${await renderPrompt("memory.peopleReview")}`,
  };
  const profileSchemaText = JSON.stringify(z.toJSONSchema(profileContentSchema));
  const reviewSchemaText = JSON.stringify(z.toJSONSchema(reviewSchema));
  let offset = 0;
  do {
    signal.throwIfAborted();
    const start = offset;
    context.materials = [];
    while (offset < materials.length) {
      const { date, text } = materials[offset];
      context.materials.push({ date, text });
      const updatePrompt = stringifyLlmMemory({ ...context, candidate: null, issues: [] });
      const reviewPrompt = stringifyLlmMemory({ ...context, candidate: context.previous });
      if (
        Buffer.byteLength(instructions.update + updatePrompt + profileSchemaText, "utf8") >=
          inputBudget ||
        Buffer.byteLength(instructions.review + reviewPrompt + reviewSchemaText, "utf8") >=
          inputBudget
      ) {
        context.materials.pop();
        break;
      }
      offset += 1;
    }
    if (offset === start && offset < materials.length) {
      throw new Error("人物画像与单条人物材料超过整理输入预算");
    }
    // 无材料的定期清理也执行一次；分批结果先留在内存，失败不写入半份画像。
    const decision = await reviewProfileBatch(context, instructions, inputBudget, signal);
    if (!decision.approved) {
      return decision;
    }
    context.previous = decision.content;
  } while (offset < materials.length);
  return { approved: true, content: context.previous };
}

/** 更新和审查使用同一份依据，每批最多三轮；每次调用前检查完整输入。 */
async function reviewProfileBatch(
  context: ProfileContext,
  instructions: { update: string; review: string },
  inputBudget: number,
  signal: AbortSignal,
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

/** 更新与定期清理共用审查和写入流程；调用失败跳过，不保存任务或恢复进度。 */
async function updateProfiles(
  characterId: string,
  people: (PersonIdentity & { name: string })[],
  materials: PersonMemoryMaterial[],
  signal: AbortSignal,
): Promise<void> {
  for (const person of people) {
    signal.throwIfAborted();
    // 各群、各批的提取结果按平台身份汇集，不再重复读取整个群的原文。
    const related = materials.filter(
      (material) => material.platform === person.platform && material.userId === person.userId,
    );
    let decision: ProfileDecision;
    try {
      decision = await reviewPersonProfile(characterId, person, related, signal);
    } catch (error) {
      signal.throwIfAborted();
      logger.warn("人物画像更新失败，本次跳过并保留旧画像", { person: person.name, error });
      continue;
    }
    if (decision.approved && decision.content !== null) {
      await writeMemoryFile(await profilePath(characterId, person), {
        ...person,
        ...decision.content,
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
    if (decision.approved) {
      const activity = await readPeopleActivity(characterId);
      const entry = activity.people.find(
        (item) => item.platform === person.platform && item.userId === person.userId,
      )!;
      entry.lastReviewedAt = Date.now();
      await writePeopleActivity(characterId, activity);
    }
  }
}

export async function organizePeople(
  characterId: string,
  materials: PersonMemoryMaterial[],
  signal: AbortSignal,
): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  const identities = new Set(
    materials.map((person) => JSON.stringify([person.platform, person.userId])),
  );
  // 使用活跃统计按真实消息时间维护的最新昵称，旧批次不能将其覆盖回旧昵称。
  const people = activity.people
    .filter((person) => identities.has(JSON.stringify([person.platform, person.userId])))
    .map(({ platform, userId, name }) => ({ platform, userId, name }));
  await updateProfiles(characterId, people, materials, signal);
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
export async function forgetPeople(characterId: string, signal: AbortSignal): Promise<void> {
  const activity = await readPeopleActivity(characterId);
  const timezone = (await load_config()).app!.timezone!;
  const cutoff = dayjs().tz(timezone).subtract(2, "month").format("YYYY-MM-DD");
  const people: (PersonIdentity & { name: string })[] = [];
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
  await updateProfiles(characterId, people, [], signal);
}
