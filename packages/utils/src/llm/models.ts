import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";
import { getYuijuConfig } from "../config/config";
import type { YuijuLlmModelSourcesConfig } from "../config/config-schema";
import { logger } from "../logger";

// 模型调用失败后的冷却时间
const MODEL_SOURCE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

type LlmModelName = "chat" | "strong" | "flash" | "vision";

class LlmModelSourceAvailability {
  private cooldownUntilList: number[];

  constructor(sourceCount: number) {
    this.cooldownUntilList = Array.from({ length: sourceCount }, () => 0);
  }

  getCandidateIndexes(now: number): number[] {
    const availableIndexes: number[] = [];
    const cooldownIndexes: number[] = [];

    for (let index = 0; index < this.cooldownUntilList.length; index += 1) {
      if (this.cooldownUntilList[index] > now) {
        cooldownIndexes.push(index);
      } else {
        availableIndexes.push(index);
      }
    }

    return [...availableIndexes, ...cooldownIndexes];
  }

  markFailed(index: number, now: number) {
    this.cooldownUntilList[index] = now + MODEL_SOURCE_FAILURE_COOLDOWN_MS;
  }
}

const jsonSchemaCapableModels = new WeakSet<object>();

/**
 * 判断某个模型是否可以直接下发 JSON Schema 由 provider 约束采样。
 *
 * 未经 createFallbackModel 登记的模型返回 false —— 宁可多走一轮提示词兜底，
 * 也不要向不支持的 provider 发出会被拒绝的请求。
 */
export function modelSupportsJsonSchema(model: unknown): boolean {
  return typeof model === "object" && model !== null && jsonSchemaCapableModels.has(model);
}

function createFallbackModel(name: LlmModelName, sources: YuijuLlmModelSourcesConfig) {
  const models = sources.map((source) => {
    const provider = createOpenAICompatible({
      baseURL: source.baseUrl,
      apiKey: source.apiKey,
      name,
      supportsStructuredOutputs: source.supportsJsonSchema === true,
    });

    return provider(source.model);
  });
  const availability = new LlmModelSourceAvailability(models.length);

  // 同一档位内会在多个来源之间轮换，任何一个来源不支持都不能下发 Schema，
  // 否则轮换到该来源时请求会被 provider 拒绝。
  const supportsJsonSchema = sources.every((source) => source.supportsJsonSchema === true);

  const fallbackModel = wrapLanguageModel({
    model: {
      specificationVersion: "v4",
      provider: `yuiju-${name}`,
      modelId: sources.map((source) => source.model).join(" -> "),
      supportedUrls: models[0].supportedUrls,

      async doGenerate(params) {
        const candidateIndexes = availability.getCandidateIndexes(Date.now());

        for (const [candidateIndex, index] of candidateIndexes.entries()) {
          try {
            return await models[index].doGenerate(params);
          } catch (error: any) {
            if (
              params.abortSignal?.aborted ||
              error?.name === "AbortError" ||
              error?.message === "replaced by newer group chat request"
            ) {
              throw error;
            }

            const now = Date.now();
            availability.markFailed(index, now);

            if (candidateIndex === candidateIndexes.length - 1) {
              throw error;
            }

            logger.error("[llm", error);

            logger.error("[llm] 模型来源调用失败，切换到备用来源", {
              modelType: name,
              modelName: sources[index]?.model,
              failedSourceIndex: index,
              errorMessage: error?.message,
            });
          }
        }

        throw new Error(`[llm] ${name} 模型没有可用来源`);
      },

      async doStream(params) {
        const candidateIndexes = availability.getCandidateIndexes(Date.now());

        for (const [candidateIndex, index] of candidateIndexes.entries()) {
          try {
            return await models[index].doStream(params);
          } catch (error: any) {
            if (
              params.abortSignal?.aborted ||
              error?.name === "AbortError" ||
              error?.message === "replaced by newer group chat request"
            ) {
              throw error;
            }

            const now = Date.now();
            availability.markFailed(index, now);

            if (candidateIndex === candidateIndexes.length - 1) {
              throw error;
            }

            logger.error("[llm] 模型来源调用失败，切换到备用来源", {
              modelType: name,
              modelName: sources[index]?.model,
              failedSourceIndex: index,
              errorMessage: error?.message,
            });
          }
        }

        throw new Error(`[llm] ${name} 模型没有可用来源`);
      },
    },
    middleware: [],
  });

  if (supportsJsonSchema) {
    jsonSchemaCapableModels.add(fallbackModel);
  }

  return fallbackModel;
}

type FallbackModel = ReturnType<typeof createFallbackModel>;

const modelCache: Partial<Record<LlmModelName, FallbackModel>> = {};

function getModel(name: LlmModelName): FallbackModel {
  const cachedModel = modelCache[name];
  if (cachedModel) {
    return cachedModel;
  }

  const sources = getYuijuConfig().llm?.models?.[name];
  if (!sources) {
    throw new Error(`llm.models.${name} 未配置`);
  }

  const model = createFallbackModel(name, sources);
  modelCache[name] = model;
  return model;
}

/**
 * 用于聊天场景，选择角色扮演效果好，响应速度快的模型
 */
export function getChatModel() {
  return getModel("chat");
}

/**
 * 用于复杂决策、长链路思考的强模型。
 */
export function getStrongModel() {
  return getModel("strong");
}

/**
 * 需要快速响应、轻文本类工作
 */
export function getFlashModel() {
  return getModel("flash");
}

/**
 * 主要用于图片描述（识图场景）
 */
export function getVisionModel() {
  return getModel("vision");
}
