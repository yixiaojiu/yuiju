import { embedMany } from "ai";
import { load_config } from "../config/load";
import { logger } from "../logger/logger";
import {
  canSwitchProvider,
  createProvider,
  markProviderFailed,
  sortProvidersByCooldown,
} from "./provider";

export async function embedTexts(
  values: string[],
  options: { abortSignal?: AbortSignal } = {},
): Promise<number[][]> {
  const config = (await load_config()).llm?.models?.embedding;
  if (!config || !config.providers.length) throw new Error("embedding 未配置供应商");
  const providers = sortProvidersByCooldown(
    config.providers.map((source, providerIndex) => ({
      source,
      providerIndex,
      providerKey: `embedding:${providerIndex}`,
    })),
  );
  for (const [index, { source, providerIndex, providerKey }] of providers.entries()) {
    options.abortSignal?.throwIfAborted();
    try {
      const provider = createProvider(source, "embedding");
      const result = await embedMany({
        model: provider.embeddingModel(source.model),
        values,
        abortSignal: options.abortSignal,
        maxRetries: 0,
        providerOptions: { embedding: { dimensions: config.dimensions } },
      });
      if (
        config.dimensions !== undefined &&
        result.embeddings.some((value) => value.length !== config.dimensions)
      ) {
        throw new Error("embedding 返回维度与配置不一致");
      }
      return result.embeddings;
    } catch (error) {
      if (!canSwitchProvider(error, options.abortSignal)) throw error;
      markProviderFailed(providerKey);
      if (index === providers.length - 1) throw error;
      logger.warn("Embedding 请求失败，切换供应商", { providerIndex });
    }
  }
  throw new Error("embedding 没有可用供应商");
}
