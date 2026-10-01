import { generateText, NoObjectGeneratedError, type Output, type ToolSet } from "ai";
import { JSONRepairError, jsonrepair } from "jsonrepair";
import { logger } from "../logger/logger";
import { flashModel, type StructuredFallback } from "./models";

const jsonPrompt = "你需要返回符合以下 JSON Schema 的 JSON，不要附加解释或 Markdown 代码围栏。";
const repairPrompt =
  "你需要修复给定内容，使其成为符合 JSON Schema 的 JSON。保留原文表达的值，不编造缺失的业务事实。只输出 JSON，不输出解释或代码围栏。";

type RuntimeContext = Record<string, unknown>;

export async function generateStructuredOutput<TOOLS extends ToolSet, OUTPUT extends Output.Output>(
  options: Parameters<typeof generateText<TOOLS, RuntimeContext, OUTPUT>>[0] & {
    model: typeof flashModel;
    output: OUTPUT;
    fallback?: StructuredFallback;
  },
) {
  const { model, output, fallback } = options;
  const responseFormat = await output.responseFormat;
  if (responseFormat?.type !== "json" || !responseFormat.schema) {
    throw new Error("generateStructuredOutput 需要携带 JSON Schema 的 output");
  }

  const structuredModel = model.withStructuredFallback(
    fallback ??
      (async ({ model, params }) =>
        model.doGenerate({
          ...params,
          responseFormat: { type: "text" },
          prompt: [
            { role: "system", content: `${jsonPrompt}\n${JSON.stringify(responseFormat.schema)}` },
            ...params.prompt,
          ],
        })),
  );

  // 将修复放在最终解析阶段，保留原请求 steps、工具结果和用量，不重新运行生成流程。
  const repairedOutput: OUTPUT = {
    ...output,
    async parseCompleteOutput(value, context) {
      let validationError: unknown;
      try {
        return await output.parseCompleteOutput(value, context);
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        validationError = error;
      }
      options.abortSignal?.throwIfAborted();

      let repairedText: string | undefined;
      try {
        repairedText = jsonrepair(value.text);
      } catch (error) {
        if (!(error instanceof JSONRepairError)) throw error;
      }
      if (repairedText !== undefined) {
        try {
          return await output.parseCompleteOutput({ text: repairedText }, context);
        } catch (error) {
          if (!NoObjectGeneratedError.isInstance(error)) throw error;
          validationError = error;
        }
      }

      logger.warn("结构化输出校验失败，执行一次 JSON 修复");
      const repairResult = await generateText({
        model: flashModel,
        maxRetries: 0,
        abortSignal: options.abortSignal,
        instructions: `${repairPrompt}\n${JSON.stringify(responseFormat.schema)}`,
        prompt: JSON.stringify({
          generatedText: value.text,
          validationError: String(
            validationError instanceof Error ? validationError.cause : validationError,
          ),
        }),
      });
      logger.info("JSON 修复请求完成", { usage: repairResult.usage });
      const repaired = jsonrepair(repairResult.text);
      return output.parseCompleteOutput(
        { text: repaired },
        {
          response: repairResult.response,
          usage: repairResult.usage,
          finishReason: repairResult.finishReason,
        },
      );
    },
  };

  return generateText({
    ...options,
    model: structuredModel,
    output: repairedOutput,
    maxRetries: 0,
  });
}
