import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { flashModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";

/** 只生成活动中的小插曲；状态结算、持久化和通知仍由 World 负责。 */
export async function generateRandomEvent(
  input: {
    name: string;
    occurredAt: number;
    timezone: string;
    place: string;
    weather: string;
    activity: string;
    positive: boolean;
  },
  signal: AbortSignal,
): Promise<string> {
  const instructions = await renderPrompt("world.random_event", {
    name: input.name,
    time: formatLlmDateTime(input.occurredAt, input.timezone),
    place: input.place,
    weather: input.weather,
    activity: input.activity,
    tone: input.positive ? "积极的小插曲" : "有些不顺利的小插曲",
  });
  const result = await generateStructuredOutput({
    model: flashModel,
    instructions,
    prompt: "请生成这一次小插曲。",
    abortSignal: signal,
    output: Output.object({
      schema: z.strictObject({
        description: z.string().min(1).max(1000).describe("你生成的日常小插曲，只包含外部事实"),
      }),
    }),
  });
  return result.output.description;
}
