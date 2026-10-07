import { load_config } from "@yuiju/shared/config/load";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { strongModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";
import { stringifyLlmMemory } from "../conversation/platform";
import type { ExperienceMemory } from "./experiences";
import { prepareSelfCognition, type SelfCognition } from "./self-cognition";

const reviewSchema = z.strictObject({
  issues: z.array(z.string()).describe("你在自我认知中发现的具体问题；通过时为空。"),
});

/** 生成与审查使用相同的旧认知和经历正文；最多三轮，只修改自我认知。 */
export async function prepareReviewedSelfCognition(
  characterId: string,
  batchId: string,
  previous: SelfCognition,
  experience: ExperienceMemory,
  signal: AbortSignal,
): Promise<SelfCognition> {
  const instructions = `${await renderPrompt(`character.persona.${characterId}`)}\n\n${await renderPrompt("memory.selfCognitionReview")}`;
  const budget = (await load_config()).llm!.models!.strong!.context_window_tokens! * 0.8;
  let cognition = await prepareSelfCognition(characterId, batchId, previous, experience, signal);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    // 与生成使用同一份依据，审查只额外接收候选认知，不读取原始聊天或世界事件。
    const prompt = stringifyLlmMemory({
      previous: previous.text,
      experience: { date: experience.startDate, text: experience.text },
      cognition: cognition.text,
    });
    if (Buffer.byteLength(instructions + prompt, "utf8") >= budget) {
      throw new Error("自我认知与经历正文超过审查窗口");
    }
    const result = await generateStructuredOutput({
      model: strongModel,
      instructions,
      prompt,
      output: Output.object({ schema: reviewSchema }),
      abortSignal: signal,
    });
    if (result.finishReason !== "stop") {
      throw new Error("自我认知审查未完整结束，保留原文和整理进度");
    }
    const { issues } = result.output;
    if (issues.length === 0) {
      return cognition;
    }
    if (attempt === 2) {
      logger.warn("自我认知三轮审查仍有意见，按约定保存当前内容", {
        characterId,
        batchId,
        issues,
      });
      break;
    }
    cognition = await prepareSelfCognition(characterId, batchId, previous, experience, signal, {
      text: cognition.text,
      issues,
    });
  }
  return cognition;
}
