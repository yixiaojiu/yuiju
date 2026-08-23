import { z } from "zod";

/**
 * 消息平台 WebSocket 重连配置。
 */
export interface YuijuMessageWebSocketReconnectConfig {
  retryTimes: number;
  retryInterval: number;
  retryLazy: number;
}

/**
 * message 进程暴露给内部调用方的 HTTP 服务配置。
 */
export interface YuijuMessageInternalApiConfig {
  host: string;
  port: number;
}

/**
 * Web 私聊渠道配置。
 */
export interface YuijuMessageWebConfig {
  enabled: boolean;
  ownerId: string;
  ownerName: string;
}

/**
 * OneBot 消息平台配置。
 */
export interface YuijuOneBotConfig extends YuijuMessageWebSocketReconnectConfig {
  protocol: "ws";
  selfId: string;
  endpoint: string;
  token: string;
  responseTimeout: number;
  whiteList: number[];
  ownerList: number[];
  groupWhiteList: number[];
}

/**
 * Lark / 飞书消息平台配置。
 */
export interface YuijuLarkConfig extends YuijuMessageWebSocketReconnectConfig {
  protocol: "ws";
  endpoint: string;
  appId: string;
  appSecret: string;
  whiteList: string[];
  ownerList: string[];
  groupWhiteList: string[];
}

/**
 * 单个表情包配置。
 *
 * 说明：
 * - `uri` 使用项目根目录相对路径，避免把机器相关的绝对路径写进配置；
 * - `description` 会暴露给 LLM，帮助模型理解使用语境。
 */
export interface YuijuStickerConfig {
  uri: string;
  description: string;
}

/**
 * 表情包映射表。
 *
 * 说明：
 * - key 是 LLM 输出 `[[sticker:key]]` 时使用的稳定标识；
 * - value 描述静态资源位置与使用语义。
 */
export type YuijuStickerMap = Record<string, YuijuStickerConfig>;

/**
 * 消息服务相关配置。
 */
export interface YuijuMessageConfig {
  onebot: YuijuOneBotConfig;
  lark: YuijuLarkConfig;
  internalApi: YuijuMessageInternalApiConfig;
  web: YuijuMessageWebConfig;
  proactive: {
    onebotGroupTargetId?: number;
    larkGroupTargetId?: string;
  };
  stickers: YuijuStickerMap;
}

/**
 * 数据存储相关配置。
 */
export interface YuijuDatabaseConfig {
  mongoUri: string;
  redisUrl: string;
  qdrant?: {
    baseUrl: string;
    apiKey?: string;
  };
  /**
   * 数据同步的 Mongo URI
   */
  syncMongoUri?: string;
  /**
   * 数据同步的 Redis URI
   */
  syncRedisUrl?: string;
}

/**
 * LLM 提供商相关配置。
 */
export interface YuijuLlmModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * 该来源的 provider 是否支持 json_schema 结构化采样。
   *
   * 说明：
   * - 为 true 时，JSON Schema 会作为 response_format 直接下发给 provider，
   *   由 provider 在采样阶段约束输出结构；
   * - 为 false 或未配置时，只要求 provider 输出 JSON，Schema 改写进提示词，
   *   并在解析失败时走 flash 模型的修正流程；
   * - 不确定就不要配。配成 true 但 provider 实际不支持时，
   *   请求会被 provider 拒绝，而不是静默降级。
   */
  supportsJsonSchema?: boolean;
}

export interface YuijuEmbeddingModelConfig extends YuijuLlmModelConfig {
  dimensions: number;
}

export type YuijuLlmModelSourcesConfig = [YuijuLlmModelConfig, ...YuijuLlmModelConfig[]];

export interface YuijuLlmModelsConfig {
  chat: YuijuLlmModelSourcesConfig;
  strong: YuijuLlmModelSourcesConfig;
  flash: YuijuLlmModelSourcesConfig;
  vision: YuijuLlmModelSourcesConfig;
  embedding?: YuijuEmbeddingModelConfig;
}

export interface YuijuLlmConfig {
  models: YuijuLlmModelsConfig;
}

export interface YuijuWorldConfig {
  phone?: {
    mapillaryAccessToken?: string;
  };
}

export interface YuijuLangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface YuijuObservabilityConfig {
  langfuse: YuijuLangfuseConfig;
}

/**
 * 项目级运行配置。
 */
export interface YuijuAppConfig {
  publicDeployment: boolean;
  timezone: string;
  /**
   * 记忆目录绝对路径。
   *
   * 说明：
   * - 配置文件里必须直接填写绝对路径；
   * - 业务代码会在这个目录下继续拼接 `people`、`demo` 等子目录。
   */
  memoryDir: string;
}

/**
 * 项目根配置总结构。
 *
 * 说明：
 * - 所有原先散落在 .env / 子包 config.ts 中的运行配置统一收口到这里；
 * - NODE_ENV 仍保留为运行时环境变量，因此不纳入该配置结构。
 */
export interface YuijuConfig {
  app: YuijuAppConfig;
  database: YuijuDatabaseConfig;
  llm: YuijuLlmConfig;
  world: YuijuWorldConfig;
  message: YuijuMessageConfig;
  /** 未配置时不启用 LLM trace。 */
  observability?: YuijuObservabilityConfig;
}

const yuijuMessageWebSocketReconnectConfigShape = {
  retryTimes: z.number(),
  retryInterval: z.number(),
  retryLazy: z.number(),
};

const yuijuMessageInternalApiConfigSchema: z.ZodType<YuijuMessageInternalApiConfig> = z.object({
  host: z.string(),
  port: z.number(),
});

const yuijuMessageWebConfigSchema: z.ZodType<YuijuMessageWebConfig> = z.strictObject({
  enabled: z.boolean(),
  ownerId: z.string().trim().min(1),
  ownerName: z.string().trim().min(1),
});

const yuijuOneBotConfigSchema: z.ZodType<YuijuOneBotConfig> = z.object({
  ...yuijuMessageWebSocketReconnectConfigShape,
  protocol: z.literal("ws"),
  selfId: z.string(),
  endpoint: z.string(),
  token: z.string(),
  responseTimeout: z.number(),
  whiteList: z.array(z.number()),
  ownerList: z.array(z.number()),
  groupWhiteList: z.array(z.number()),
});

const yuijuLarkConfigSchema: z.ZodType<YuijuLarkConfig> = z.object({
  ...yuijuMessageWebSocketReconnectConfigShape,
  protocol: z.literal("ws"),
  endpoint: z.string(),
  appId: z.string(),
  appSecret: z.string(),
  whiteList: z.array(z.string()),
  ownerList: z.array(z.string()),
  groupWhiteList: z.array(z.string()),
});

const yuijuStickerConfigSchema: z.ZodType<YuijuStickerConfig> = z.object({
  uri: z.string(),
  description: z.string(),
});

const yuijuMessageConfigSchema: z.ZodType<YuijuMessageConfig> = z.object({
  onebot: yuijuOneBotConfigSchema,
  lark: yuijuLarkConfigSchema,
  internalApi: yuijuMessageInternalApiConfigSchema,
  web: yuijuMessageWebConfigSchema,
  proactive: z.object({
    onebotGroupTargetId: z.number().optional(),
    larkGroupTargetId: z.string().optional(),
  }),
  stickers: z.record(z.string(), yuijuStickerConfigSchema),
});

const yuijuDatabaseConfigSchema: z.ZodType<YuijuDatabaseConfig> = z.object({
  mongoUri: z.string(),
  redisUrl: z.string(),
  qdrant: z
    .object({
      baseUrl: z.string(),
      apiKey: z.string().optional(),
    })
    .optional(),
  syncMongoUri: z.string().optional(),
  syncRedisUrl: z.string().optional(),
});

const yuijuLlmModelConfigSchema: z.ZodType<YuijuLlmModelConfig> = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  supportsJsonSchema: z.boolean().optional(),
});

const yuijuLlmModelSourcesConfigSchema: z.ZodType<YuijuLlmModelSourcesConfig> = z.tuple(
  [yuijuLlmModelConfigSchema],
  yuijuLlmModelConfigSchema,
);

const yuijuEmbeddingModelConfigSchema: z.ZodType<YuijuEmbeddingModelConfig> = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  dimensions: z.number(),
});

const yuijuLlmConfigSchema: z.ZodType<YuijuLlmConfig> = z.object({
  models: z.object({
    chat: yuijuLlmModelSourcesConfigSchema,
    strong: yuijuLlmModelSourcesConfigSchema,
    flash: yuijuLlmModelSourcesConfigSchema,
    vision: yuijuLlmModelSourcesConfigSchema,
    embedding: yuijuEmbeddingModelConfigSchema.optional(),
  }),
});

const yuijuWorldConfigSchema: z.ZodType<YuijuWorldConfig> = z.object({
  phone: z
    .object({
      mapillaryAccessToken: z.string().optional(),
    })
    .optional(),
});

const yuijuObservabilityConfigSchema: z.ZodType<YuijuObservabilityConfig> = z.object({
  langfuse: z.object({
    publicKey: z.string(),
    secretKey: z.string(),
    baseUrl: z.string(),
  }),
});

const yuijuAppConfigSchema: z.ZodType<YuijuAppConfig> = z.object({
  publicDeployment: z.boolean(),
  timezone: z.string(),
  memoryDir: z.string(),
});

/**
 * JSON 配置完成环境变量解析和默认值合并后的最终结构。
 */
export const yuijuConfigSchema: z.ZodType<YuijuConfig> = z.object({
  app: yuijuAppConfigSchema,
  database: yuijuDatabaseConfigSchema,
  llm: yuijuLlmConfigSchema,
  world: yuijuWorldConfigSchema,
  message: yuijuMessageConfigSchema,
  observability: yuijuObservabilityConfigSchema.optional(),
});
