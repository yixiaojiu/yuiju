import type { GenerateTextResult, ToolSet } from "ai";
import {
  extractJsonMiddleware,
  generateText,
  NoObjectGeneratedError,
  Output,
  wrapLanguageModel,
} from "ai";
import { logger } from "../logger";
import { structuredOutputJsonPrompt, structuredOutputRepairPrompt } from "../prompt";
import { extractLastJson } from "../utils/extract-last-json";
import { getLangfuseTelemetry } from "./langfuse-telemetry";
import { getFlashModel, modelSupportsJsonSchema } from "./models";

type GenerateTextOptions = Parameters<typeof generateText>[0];
type RuntimeContext = Record<string, unknown>;

/**
 * 专门用于生成结构化 JSON。
 *
 * 按模型来源的 `supportsJsonSchema` 配置分成两条路径：
 *
 * 1. provider 支持 json_schema（配置显式写了 true）：
 *    Schema 作为 response_format 直接下发，由 provider 在采样阶段约束输出结构。
 *    不再把 Schema 重复写进提示词——那既浪费 token，也可能与原生约束互相干扰。
 *
 * 2. provider 不支持（未配置或配置为 false）：
 *    只要求输出 JSON，Schema 改写进提示词，解析失败时用 flash 模型做一次修正。
 *
 * 默认走第 2 条。配置里没写 `supportsJsonSchema: true` 的来源一律按不支持处理，
 * 包括调用方自行构造、未经 models.ts 登记的 provider。
 */
export async function generateStructuredOutput<OUTPUT extends Output.Output>(
  options: GenerateTextOptions & {
    model: Exclude<GenerateTextOptions["model"], string>;
    output: OUTPUT;
  },
): Promise<GenerateTextResult<ToolSet, RuntimeContext, OUTPUT>> {
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

  if (options.instructions != null && typeof options.instructions !== "string") {
    throw new Error("generateStructuredOutput 当前只支持 string 类型的 instructions。");
  }

  const model = wrapLanguageModel({
    model: options.model,
    middleware: extractJsonMiddleware({
      transform: (text) => extractLastJson(text) ?? text.trim(),
    }),
  });

  // ---------------------------------------------------------------------------
  // 路径 1：provider 原生 json_schema 结构化采样
  //
  // 直接透传 options.output，AI SDK 会把 Schema 放进 response_format 下发。
  //
  // 这里不做重试：generateText 内部对每一步的模型调用已带 maxRetries（默认 2 次，
  // 指数退避，只重试 408/409/429/5xx），且范围限于失败的那一次请求，不会重放
  // 前面已执行的工具；而在外层重试会把整个多步请求连同工具副作用一起重放。
  // ---------------------------------------------------------------------------
  if (modelSupportsJsonSchema(options.model)) {
    try {
      const result = await generateText({
        ...options,
        model,
        telemetry: getLangfuseTelemetry(),
      });

      const output = await options.output.parseCompleteOutput(
        { text: result.text },
        {
          response: result.finalStep.response,
          usage: result.usage,
          finishReason: result.finishReason,
        },
      );

      return { ...result, output };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn("[llm.structured-output] 原生结构化采样未产出可解析 JSON", error.text);
      }

      throw error;
    }
  }

  const instructions = [
    options.instructions,
    structuredOutputJsonPrompt,
    JSON.stringify(responseFormat.schema),
  ].join("\n");

  try {
    const result = await generateText({
      ...options,
      model,
      instructions,
      output: Output.json(),
      telemetry: getLangfuseTelemetry(),
    });

    const output = await options.output.parseCompleteOutput(
      { text: result.text },
      {
        response: result.finalStep.response,
        usage: result.usage,
        finishReason: result.finishReason,
      },
    );

    return { ...result, output };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }

    logger.warn("[llm.structured-output] 未生成可解析 JSON，尝试修正", error.text);

    if (error.text == null) {
      throw error;
    }

    const repairResult = await generateText({
      model: wrapLanguageModel({
        model: getFlashModel(),
        middleware: extractJsonMiddleware({
          transform: (text) => extractLastJson(text) ?? text.trim(),
        }),
      }),
      providerOptions: {
        flash: {
          enable_thinking: false,
        },
      },
      abortSignal: options.abortSignal,
      instructions: [structuredOutputRepairPrompt, JSON.stringify(responseFormat.schema)].join(
        "\n",
      ),
      prompt: JSON.stringify({
        generatedText: error.text,
        validationError: String(error.cause),
      }),
      output: Output.json(),
      telemetry: getLangfuseTelemetry(),
    });

    const output = await options.output.parseCompleteOutput(
      { text: repairResult.text },
      {
        response: repairResult.finalStep.response,
        usage: repairResult.usage,
        finishReason: repairResult.finishReason,
      },
    );

    return { ...repairResult, output };
  }
}
