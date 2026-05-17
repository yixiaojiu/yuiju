import { defineYuijuConfig } from "./packages/utils/src/config/config-schema";

const config = defineYuijuConfig({
  app: {
    publicDeployment: true,
    timezone: "Asia/Shanghai",
    memoryDir: "/tmp/yuiju/memory",
  },
  database: {
    mongoUri: "",
    redisUrl: "",
    syncMongoUri: process.env.YUIJU_SYNC_MONGO_URI,
    syncRedisUrl: process.env.YUIJU_SYNC_REDIS_URL,
  },
  llm: {
    deepseekApiKey: "",
    siliconflowApiKey: "",
    models: {
      small: [
        {
          baseUrl: "",
          apiKey: "",
          model: "",
        },
      ],
      strong: [
        {
          baseUrl: "",
          apiKey: "",
          model: "",
        },
      ],
      flash: [
        {
          baseUrl: "",
          apiKey: "",
          model: "",
        },
      ],
      vision: [
        {
          baseUrl: "",
          apiKey: "",
          model: "",
        },
      ],
    },
  },
  message: {
    internalApi: {
      host: "127.0.0.1",
      port: 3020,
    },
    proactive: {
      groupTargetId: 0,
    },
    napcat: {
      protocol: "ws",
      host: "",
      port: 0,
      accessToken: "",
    },
    whiteList: [],
    groupWhiteList: [],
    stickers: {},
  },
});

export default config;
