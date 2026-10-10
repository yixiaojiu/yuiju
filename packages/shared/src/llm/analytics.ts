import { APICallError, type LanguageModelMiddleware, type wrapLanguageModel } from "ai";
import { reportAnalyticsEvent } from "../analytics/report-event";

type ModelUsage = Awaited<ReturnType<ReturnType<typeof wrapLanguageModel>["doGenerate"]>>["usage"];

/** OpenAI-compatible 原始用量；缺失与显式返回 0 的含义不同。 */
type RawUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
};

/** 挂在每个供应商模型上；现有非流式生成、结构化降级与修复均按实际请求计一次。 */
export function createLlmAnalytics(group: string, host: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async wrapGenerate({ model, params, doGenerate }) {
      const startedAt = performance.now();
      let usage: ModelUsage | undefined;
      let finishReason: string | undefined;
      let status: "success" | "failed" | "cancelled" | "timeout" = "success";
      let errorName: string | undefined;
      let statusCode: number | undefined;
      try {
        const result = await doGenerate();
        usage = result.usage;
        finishReason = result.finishReason.unified;
        if (finishReason === "error") {
          status = "failed";
        }
        return result;
      } catch (error) {
        if (params.abortSignal?.aborted) {
          status = params.abortSignal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
        } else {
          status = "failed";
        }
        errorName = error instanceof Error ? error.name : undefined;
        if (APICallError.isInstance(error)) {
          statusCode = error.statusCode;
        }
        throw error;
      } finally {
        // SDK 会把部分缺失字段补为 0；直接保留协议原值，null 表示供应商未提供。
        const raw = usage?.raw as RawUsage | undefined;
        reportAnalyticsEvent({
          eventName: "llm.request",
          eventData: {
            group,
            host,
            provider: model.provider,
            model: model.modelId,
            durationMs: Math.round(performance.now() - startedAt),
            status,
            finishReason,
            errorName,
            statusCode,
            inputTokens: raw?.prompt_tokens ?? null,
            outputTokens: raw?.completion_tokens ?? null,
            cacheReadTokens: raw?.prompt_tokens_details?.cached_tokens ?? null,
            reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? null,
          },
        });
      }
    },
  };
}
