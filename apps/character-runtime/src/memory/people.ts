import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { strongModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";
import { formatLlmPlatform, stringifyLlmMemory } from "../conversation/platform";
import type { ExperienceMaterial } from "./experiences";
import { memoryPath, writeMemoryFile } from "./files";

export type PersonIdentity = { platform: string; userId: string };
type Recognition = {
  id: string;
  text: string;
  lifetime: "temporary" | "lasting";
  occurredAt: number;
  source: { materialId: string; platform: string; channelId: string };
};
export type PersonProfile = PersonIdentity & {
  name: string;
  facts: Recognition[];
  impressions: Recognition[];
  lastBatchId: string | null;
};

const identitySchema = z.strictObject({ platform: z.string().min(1), userId: z.string().min(1) });
const linksSchema = z.array(z.array(identitySchema).min(2));
const entrySchema = z.strictObject({
  text: z.string().min(1).max(400),
  sourceId: z.string().min(1),
  lifetime: z.enum(["temporary", "lasting"]),
});
const profileOutputSchema = z.strictObject({
  facts: z.array(entrySchema).max(20),
  impressions: z.array(entrySchema).max(20),
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
    return JSON.parse(await readFile(await profilePath(characterId, identity), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
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
}

/** 每次按手动关联文件联合读取；不自动推断身份，也不永久合并平台档案。 */
export async function readPeople(
  characterId: string,
  identity: PersonIdentity,
  scope?: { platform: string; channelId: string },
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
  const allowed = (entry: Recognition) =>
    Date.now() - entry.occurredAt <= (entry.lifetime === "temporary" ? 30 : 365) * 86_400_000 &&
    (!scope ||
      (entry.source.platform === scope.platform && entry.source.channelId === scope.channelId));
  return profiles
    .filter((profile): profile is PersonProfile => profile !== null)
    .map((profile) => ({
      ...profile,
      facts: profile.facts.filter(allowed),
      impressions: profile.impressions.filter(allowed),
    }));
}

/** 模型只读取认知正文、日期和交流范围，不接收文件整理进度等内部字段。 */
export async function formatPeople(profiles: PersonProfile[]): Promise<string> {
  const timezone = (await load_config()).app!.timezone!;
  const describe = (entries: Recognition[]) =>
    entries
      .map(
        (entry) =>
          `${formatLlmDateTime(entry.occurredAt, timezone)}：${entry.text}（来源：${formatLlmPlatform(entry.source.platform)}/${entry.source.channelId}）`,
      )
      .join("\n");
  return (
    profiles
      .map((profile) =>
        [
          `${profile.name}（${formatLlmPlatform(profile.platform)} / ${profile.userId}）`,
          `我知道的事：\n${describe(profile.facts)}`,
          `我的认识与关系感受：\n${describe(profile.impressions)}`,
        ].join("\n"),
      )
      .join("\n\n") || "没有当前可用的人物认识；这不代表第一次相识。"
  );
}

/** 日期只取直接支持这条认识的材料；整理或读取不会替旧认知续期。 */
export async function organizePeople(
  characterId: string,
  batchId: string,
  materials: ExperienceMaterial[],
  signal: AbortSignal,
): Promise<void> {
  const identities = new Map(
    materials
      .flatMap((material) => material.people)
      .map((person) => [`${person.platform}:${person.userId}`, person]),
  );
  for (const person of identities.values()) {
    const previous = await readProfile(characterId, person);
    if (previous?.lastBatchId === batchId) {
      continue;
    }
    const related = materials.filter(
      (material) =>
        material.conversation &&
        material.people.some(
          (item) => item.platform === person.platform && item.userId === person.userId,
        ),
    );
    const profiles = await readPeople(characterId, person);
    const own = profiles.find(
      (profile) => profile.platform === person.platform && profile.userId === person.userId,
    );
    const sources = new Map<string, Pick<Recognition, "occurredAt" | "source">>();
    for (const entry of [...(own?.facts ?? []), ...(own?.impressions ?? [])]) {
      sources.set(entry.id, entry);
    }
    for (const material of related) {
      sources.set(material.id, {
        occurredAt: material.occurredAt,
        source: { materialId: material.id, ...material.conversation! },
      });
    }
    const result = await generateStructuredOutput({
      model: strongModel,
      output: Output.object({ schema: profileOutputSchema }),
      instructions: await renderPrompt("memory.people"),
      prompt: stringifyLlmMemory({
        person,
        own,
        linked: profiles.filter((profile) => profile !== own),
        materials: related,
      }),
      abortSignal: signal,
    });
    const entries = (values: z.infer<typeof entrySchema>[]): Recognition[] =>
      values.map((entry) => {
        const source = sources.get(entry.sourceId);
        if (!source) {
          throw new Error(`画像引用了当前身份之外或不存在的依据：${entry.sourceId}`);
        }
        return {
          id: createHash("sha256")
            .update(`${source.source.materialId}:${entry.text}`)
            .digest("hex"),
          text: entry.text,
          lifetime: entry.lifetime,
          occurredAt: source.occurredAt,
          source: source.source,
        };
      });
    await writeMemoryFile(await profilePath(characterId, person), {
      ...person,
      facts: entries(result.output.facts),
      impressions: entries(result.output.impressions),
      lastBatchId: batchId,
    } satisfies PersonProfile);
  }
}

/** 每日覆盖全部画像，长期不再交往的人同样遗忘；不需要为了删除过期条目调用模型。 */
export async function forgetPeople(characterId: string): Promise<void> {
  const root = await memoryPath(characterId, "people");
  for (const platform of await readdir(root, { withFileTypes: true })) {
    if (!platform.isDirectory()) {
      continue;
    }
    for (const file of await readdir(join(root, platform.name))) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const path = join(root, platform.name, file);
      const profile: PersonProfile = JSON.parse(await readFile(path, "utf8"));
      const retain = (entry: Recognition) =>
        Date.now() - entry.occurredAt <= (entry.lifetime === "temporary" ? 30 : 365) * 86_400_000;
      const facts = profile.facts.filter(retain);
      const impressions = profile.impressions.filter(retain);
      if (
        facts.length !== profile.facts.length ||
        impressions.length !== profile.impressions.length
      ) {
        await writeMemoryFile(path, { ...profile, facts, impressions });
      }
    }
  }
}
