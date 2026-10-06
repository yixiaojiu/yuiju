import { randomUUID } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError } from "ai";
import type { Config } from "../config/schema";
import { logger } from "../logger/logger";

export type LlmModels = NonNullable<NonNullable<Config["llm"]>["models"]>;
type ProviderConfig = NonNullable<LlmModels["chat"]>["providers"][number];

const cooldownUntil = new Map<string, number>();

export function markProviderFailed(providerKey: string) {
  cooldownUntil.set(providerKey, Date.now() + 10 * 60 * 1000);
}

export function sortProvidersByCooldown<T extends { providerKey: string }>(providers: T[]): T[] {
  const now = Date.now();
  // 稳定排序：未冷却者优先，两组内部均保留配置顺序。
  return [...providers].sort(
    (a, b) =>
      Number((cooldownUntil.get(a.providerKey) ?? 0) > now) -
      Number((cooldownUntil.get(b.providerKey) ?? 0) > now),
  );
}

export function createProvider(config: ProviderConfig, name: string) {
  const reserved = [
    "model",
    "messages",
    "input",
    "tools",
    "tool_choice",
    "stream",
    "stream_options",
    "response_format",
    "dimensions",
    "encoding_format",
  ];
  for (const key of Object.keys(config.request ?? {})) {
    if (reserved.includes(key)) throw new Error(`request 不允许覆盖 ${key}`);
  }

  return createOpenAICompatible({
    name,
    baseURL: config.base_url,
    apiKey: config.api_key,
    headers: config.headers,
    supportsStructuredOutputs: config.supports_structured_outputs === true,
    // request 提供默认参数，业务请求的同名字段优先；嵌套对象整项覆盖，embedding 同样适用。
    fetch: async (url, init) => {
      if (typeof init?.body !== "string") throw new Error("LLM 请求体必须是 JSON 字符串");
      const requestBody = { ...config.request, ...JSON.parse(init.body) };
      const request = {
        ...init,
        body: JSON.stringify(requestBody),
      };
      const traceId = logger.isLevelEnabled("silly") ? randomUUID() : undefined;
      const startedAt = Date.now();
      if (traceId) {
        logger.silly("e2e.llm.request", { traceId, provider: name, request: requestBody });
      }
      try {
        const response = await fetch(url, request);
        if (traceId) {
          // 临时观察非流式正文；副本不替代 SDK 消费，流式请求不等整条流结束。
          logger.silly("e2e.llm.response", {
            traceId,
            provider: name,
            status: response.status,
            elapsedMs: Date.now() - startedAt,
            body: requestBody.stream ? "流式正文未记录" : await response.clone().text(),
          });
        }
        return response;
      } catch (error) {
        if (traceId) {
          logger.silly("e2e.llm.error", { traceId, provider: name, error });
        }
        if (init.signal?.aborted || !(error instanceof TypeError)) throw error;
        throw new APICallError({
          message: "LLM 网络请求失败",
          url: String(url),
          requestBodyValues: undefined,
          cause: error,
          isRetryable: true,
        });
      }
    },
  });
}

export function canSwitchProvider(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  // SDK 将网络故障和可重试 HTTP 错误封装为 APICallError。
  return APICallError.isInstance(error) && error.isRetryable;
}
