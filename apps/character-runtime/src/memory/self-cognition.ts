import { readFile } from "node:fs/promises";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { strongModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";
import { stringifyLlmMemory } from "../conversation/platform";
import type { ExperienceMemory } from "./experiences";
import { memoryPath, writeMemoryFile } from "./files";

export const selfCognitionSchema = z.strictObject({
  text: z.string().min(1),
  /** 初始生活背景没有虚构的发生日期；日后更新取实际整理时间。 */
  updatedAt: z.number().nullable(),
  lastBatchId: z.string().nullable(),
});
export type SelfCognition = z.infer<typeof selfCognitionSchema>;

export async function selfCognitionPath(characterId: string): Promise<string> {
  return await memoryPath(characterId, "self-cognition.json");
}

/** 只有文件不存在才写入已编写的初始生活认识，不让模型现场编造过去。 */
export async function initializeSelfCognition(characterId: string): Promise<void> {
  const path = await selfCognitionPath(characterId);
  try {
    selfCognitionSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const cognition: SelfCognition = {
    text: await renderPrompt(`character.initialCognition.${characterId}`),
    updatedAt: null,
    lastBatchId: null,
  };
  await writeMemoryFile(path, cognition);
}

export async function readSelfCognition(characterId: string): Promise<SelfCognition> {
  return selfCognitionSchema.parse(
    JSON.parse(await readFile(await selfCognitionPath(characterId), "utf8")),
  );
}

/** 根据经历草稿生成候选；自我认知审查结束后由每日任务保存，不在生成时改写当前认知。 */
export async function prepareSelfCognition(
  characterId: string,
  batchId: string,
  previous: SelfCognition,
  experience: ExperienceMemory,
  signal: AbortSignal,
  revision?: { text: string; issues: string[] },
): Promise<SelfCognition> {
  const result = await generateStructuredOutput({
    model: strongModel,
    output: Output.object({
      schema: z.strictObject({ changed: z.boolean(), text: z.string().min(1).max(1600) }),
    }),
    instructions: `${await renderPrompt(`character.persona.${characterId}`)}\n\n${await renderPrompt("memory.selfCognition")}`,
    prompt: stringifyLlmMemory({
      previous: previous.text,
      experience: { date: experience.startDate, text: experience.text },
      revision,
    }),
    abortSignal: signal,
  });
  if (result.finishReason !== "stop") {
    throw new Error("自我认知未完整生成，保留原文和整理进度");
  }
  return {
    text: result.output.changed ? result.output.text : previous.text,
    updatedAt: result.output.changed ? Date.now() : previous.updatedAt,
    lastBatchId: batchId,
  };
}
