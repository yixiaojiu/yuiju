import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";
import {
  getYuijuConfig,
  type YuijuLlmModelSourcesConfig,
  type YuijuLlmModelsConfig,
} from "../config";
import { logger } from "../logger";

const config = getYuijuConfig();

function createFallbackModel(
  name: keyof YuijuLlmModelsConfig,
  sources: YuijuLlmModelSourcesConfig,
) {
  const models = sources.map((source) => {
    const provider = createOpenAICompatible({
      baseURL: source.baseUrl,
      apiKey: source.apiKey,
      name,
      supportsStructuredOutputs: true,
    });

    return provider(source.model);
  });

  return wrapLanguageModel({
    model: {
      specificationVersion: "v3",
      provider: `yuiju-${name}`,
      modelId: sources.map((source) => source.model).join(" -> "),
      supportedUrls: models[0].supportedUrls,

      async doGenerate(params) {
        for (const [index, model] of models.entries()) {
          try {
            return await model.doGenerate(params);
          } catch (error) {
            if (index === models.length - 1) {
              throw error;
            }

            logger.error("[llm] 模型来源调用失败，切换到备用来源", {
              modelType: name,
              failedSourceIndex: index,
            });
          }
        }

        throw new Error(`[llm] ${name} 模型没有可用来源`);
      },

      async doStream(params) {
        for (const [index, model] of models.entries()) {
          try {
            return await model.doStream(params);
          } catch (error) {
            if (index === models.length - 1) {
              throw error;
            }

            logger.error("[llm] 模型来源调用失败，切换到备用来源", {
              modelType: name,
              failedSourceIndex: index,
            });
          }
        }

        throw new Error(`[llm] ${name} 模型没有可用来源`);
      },
    },
    middleware: [],
  });
}

/**
 * 用于低成本判断、裁决等轻量任务的小模型。
 */
export const smallModel = createFallbackModel("small", config.llm.models.small);

/**
 * 用于复杂决策、长链路思考的强模型。
 */
export const strongModel = createFallbackModel("strong", config.llm.models.strong);

/**
 * 需要快速响应、轻文本类工作
 */
export const flashModel = createFallbackModel("flash", config.llm.models.flash);

/**
 * 主要用于图片描述（识图场景）
 */
export const visionModel = createFallbackModel("vision", config.llm.models.vision);
