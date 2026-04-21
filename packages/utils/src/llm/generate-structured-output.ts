import { generateText, Output } from "ai";

type GenerateTextOptions = Parameters<typeof generateText>[0];
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;
type StructuredOutputResultContext = Pick<
  GenerateTextResult,
  "response" | "usage" | "finishReason"
>;
type StructuredOutput = {
  responseFormat: PromiseLike<unknown>;
  parseCompleteOutput: (
    options: { text: string },
    context: StructuredOutputResultContext,
  ) => Promise<unknown>;
};
type StructuredOutputValue<OUTPUT extends StructuredOutput> = Awaited<
  ReturnType<OUTPUT["parseCompleteOutput"]>
>;

/**
 * 专门用于生成结构化 JSON。
 * 它会把 output 里的 JSON Schema 注入 system prompt，
 * 再复用 output 自带的解析逻辑完成最终校验。
 */
export async function generateStructuredOutput<OUTPUT extends StructuredOutput>(
  options: Omit<GenerateTextOptions, "output" | "experimental_output"> & {
    output: OUTPUT;
  },
): Promise<
  Omit<GenerateTextResult, "output" | "experimental_output"> & {
    output: StructuredOutputValue<OUTPUT>;
    experimental_output: StructuredOutputValue<OUTPUT>;
  }
> {
  const responseFormat = await options.output.responseFormat;
  if (
    responseFormat == null ||
    typeof responseFormat !== "object" ||
    !("type" in responseFormat) ||
    responseFormat.type !== "json" ||
    !("schema" in responseFormat) ||
    responseFormat.schema == null
  ) {
    throw new Error("generateStructuredOutput 只支持携带 JSON Schema 的结构化 output。");
  }

  if (options.system != null && typeof options.system !== "string") {
    throw new Error("generateStructuredOutput 当前只支持 string 类型的 system prompt。");
  }

  const result = await generateText({
    ...options,
    system: [
      options.system,
      options.system ? "" : undefined,
      "只输出 JSON 字符串，不要输出 Markdown 代码块。",
      "输出必须严格满足下面的 JSON Schema。",
      "JSON Schema:",
      JSON.stringify(responseFormat.schema),
    ]
      .filter((item) => item != null)
      .join("\n"),
    output: Output.text(),
  } as Parameters<typeof generateText>[0]);

  const normalizedText = result.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsedOutput = (await options.output.parseCompleteOutput(
    { text: normalizedText },
    {
      response: result.response,
      usage: result.usage,
      finishReason: result.finishReason,
    },
  )) as StructuredOutputValue<OUTPUT>;

  return {
    ...result,
    output: parsedOutput,
    experimental_output: parsedOutput,
  };
}
