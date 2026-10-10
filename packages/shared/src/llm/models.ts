import { APICallError, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { load_config } from "../config/load";
import { logger } from "../logger/logger";
import { createLlmAnalytics } from "./analytics";
import {
  canSwitchProvider,
  createProvider,
  markProviderFailed,
  sortProvidersByCooldown,
} from "./provider";

type Model = ReturnType<typeof wrapLanguageModel>;
type StreamPart = Awaited<ReturnType<Model["doStream"]>>["stream"] extends ReadableStream<
  infer Part
>
  ? Part
  : never;
type ModelName = "chat" | "strong" | "flash" | "multimodal";
type InputModality = "image" | "audio" | "video";
export type StructuredFallback = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type SharedModel = Model & {
  withStructuredFallback(fallback: StructuredFallback): SharedModel;
};
type Candidate = {
  providerKey: string;
  host: string;
  model: Model;
  supportsStructuredOutputs: boolean;
  inputModalities?: string[];
};

function selectCandidates(candidates: Candidate[], params: Parameters<Model["doGenerate"]>[0]) {
  const required = new Set<string>();
  // 文本输入是基础能力，供应商只需声明额外支持的媒体类型。
  for (const message of params.prompt) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "file") required.add(part.mediaType.split("/")[0]);
    }
  }
  return candidates.filter(
    (candidate) =>
      !candidate.inputModalities ||
      [...required].every((type) => candidate.inputModalities!.includes(type)),
  );
}

function createModel(
  name: string,
  getCandidates: () => Promise<Candidate[]>,
  fallback?: StructuredFallback,
): SharedModel {
  return {
    specificationVersion: "v4",
    provider: `yuiju.${name}`,
    modelId: name,
    supportedUrls: {},
    withStructuredFallback(nextFallback) {
      return createModel(name, getCandidates, nextFallback);
    },
    async doGenerate(params) {
      const available = sortProvidersByCooldown(
        selectCandidates(await getCandidates(), params).filter(
          (candidate) =>
            params.responseFormat?.type !== "json" ||
            !params.responseFormat.schema ||
            candidate.supportsStructuredOutputs ||
            fallback,
        ),
      );
      if (!available.length) {
        throw new Error(`${name} 没有满足本次输入与输出能力要求的供应商`);
      }
      for (const [index, candidate] of available.entries()) {
        params.abortSignal?.throwIfAborted();
        // 每个供应商请求独立计时；工具执行不计时，生活决策沿用原有策略。
        const providerTimeout =
          name === "chat" || name === "flash" ? AbortSignal.timeout(60_000) : undefined;
        // 把信号交给 SDK 的底层 fetch，超时会终止响应正文读取，而非仅停止等待。
        const abortSignal = AbortSignal.any(
          [params.abortSignal, providerTimeout].filter(
            (signal): signal is AbortSignal => signal !== undefined,
          ),
        );
        const requestParams = { ...params, abortSignal };
        const startedAt = Date.now();
        const logContext = {
          group: name,
          provider: candidate.model.provider,
          host: candidate.host,
          model: candidate.model.modelId,
          attempt: index + 1,
        };

        try {
          let result: Awaited<ReturnType<Model["doGenerate"]>>;
          if (
            params.responseFormat?.type === "json" &&
            params.responseFormat.schema &&
            !candidate.supportsStructuredOutputs &&
            fallback
          ) {
            result = await fallback({
              model: candidate.model,
              params: requestParams,
              doGenerate: () => candidate.model.doGenerate(requestParams),
              doStream: () => candidate.model.doStream(requestParams),
            });
          } else {
            result = await candidate.model.doGenerate(requestParams);
          }
          abortSignal.throwIfAborted();

          return result;
        } catch (error) {
          // 用户/业务主动取消不能触发供应商切换。
          if (params.abortSignal?.aborted) {
            throw params.abortSignal.reason;
          }
          const timedOut = providerTimeout?.aborted === true;
          const retryable = timedOut || canSwitchProvider(error, params.abortSignal);
          const willSwitch = retryable && index < available.length - 1;
          logger.warn(timedOut ? "供应商请求超过 60 秒" : "模型请求失败", {
            ...logContext,
            durationMs: Date.now() - startedAt,
            willSwitch,
            errorMessage: error instanceof Error ? error.message : String(error),
            ...(APICallError.isInstance(error) && { statusCode: error.statusCode }),
          });
          if (!retryable) {
            throw error;
          }
          markProviderFailed(candidate.providerKey);
          if (!willSwitch) {
            throw new Error(`${name} 所有供应商请求失败`, { cause: error });
          }
        }
      }
      throw new Error(`${name} 没有可用供应商`);
    },
    async doStream(params) {
      const available = sortProvidersByCooldown(
        selectCandidates(await getCandidates(), params).filter(
          (candidate) =>
            params.responseFormat?.type !== "json" ||
            !params.responseFormat.schema ||
            candidate.supportsStructuredOutputs,
        ),
      );
      if (!available.length) throw new Error(`${name} 没有满足本次输入与输出能力要求的供应商`);
      for (const [index, candidate] of available.entries()) {
        params.abortSignal?.throwIfAborted();
        let reader: ReadableStreamDefaultReader<StreamPart> | undefined;
        let streamFailed = false;
        try {
          const result = await candidate.model.doStream(params);
          reader = result.stream.getReader();
          const prefix: StreamPart[] = [];
          let done = false;
          // 首个可交付内容前先检查流中的错误；交付后不再切换供应商。
          while (true) {
            const item = await reader.read().catch((error: unknown) => {
              streamFailed = true;
              throw error;
            });
            if (item.done) {
              done = true;
              break;
            }
            if (item.value.type === "error") {
              streamFailed = true;
              throw item.value.error;
            }
            prefix.push(item.value);
            if (!["stream-start", "response-metadata", "raw"].includes(item.value.type)) break;
          }
          const activeReader = reader;
          return {
            ...result,
            stream: new ReadableStream({
              async pull(controller) {
                if (prefix.length) {
                  controller.enqueue(prefix.shift()!);
                  return;
                }
                if (done) {
                  controller.close();
                  return;
                }
                const item = await activeReader.read();
                if (item.done) controller.close();
                else controller.enqueue(item.value);
              },
              cancel(reason) {
                return activeReader.cancel(reason);
              },
            }),
          };
        } catch (error) {
          // 清理失败的流不能覆盖原始请求错误。
          if (reader) await Promise.allSettled([reader.cancel()]);
          if (params.abortSignal?.aborted || (!streamFailed && !canSwitchProvider(error)))
            throw error;
          markProviderFailed(candidate.providerKey);
          if (index === available.length - 1)
            throw new Error(`${name} 所有供应商请求失败`, { cause: error });
          logger.warn("流式请求失败，切换供应商", {
            group: name,
            provider: candidate.model.provider,
          });
        }
      }
      throw new Error(`${name} 没有可用供应商`);
    },
  };
}

function createGroupModel(name: ModelName, inputModalities: readonly InputModality[] = []) {
  let candidates: Promise<Candidate[]> | undefined;
  const getCandidates = () => {
    candidates ??= load_config().then((config) => {
      const providers: (Parameters<typeof createProvider>[0] & {
        input_modalities?: InputModality[];
      })[] = config.llm?.models?.[name]?.providers ?? [];
      return providers
        .map((source, index) => ({ source, index }))
        .filter(
          ({ source }) =>
            source.input_modalities === undefined ||
            inputModalities.every((type) => source.input_modalities!.includes(type)),
        )
        .map(({ source, index }) => ({
          providerKey: `${name}:${index}`,
          host: new URL(source.base_url).host,
          model: wrapLanguageModel({
            model: createProvider(source, `${name}${index}`).chatModel(source.model),
            middleware: createLlmAnalytics(name, new URL(source.base_url).host),
          }),
          supportsStructuredOutputs: source.supports_structured_outputs === true,
          inputModalities: source.input_modalities,
        }));
    });
    return candidates;
  };
  return createModel(name, getCandidates);
}

export const chatModel = createGroupModel("chat");
export const strongModel = createGroupModel("strong");
export const flashModel = createGroupModel("flash");

export function getMultimodalModel(inputModalities: readonly InputModality[]) {
  return createGroupModel("multimodal", inputModalities);
}
