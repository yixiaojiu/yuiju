import { z } from "zod";

const provider_schema = z.strictObject({
  base_url: z.url(),
  api_key: z.string().optional(),
  model: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  request: z.record(z.string(), z.json()).optional(),
});

const model_group_schema = z.strictObject({
  context_window_tokens: z.number().int().positive().optional(),
  providers: z.array(
    provider_schema.extend({
      supports_structured_outputs: z.boolean().optional(),
    }),
  ),
});

export const config_schema = z.strictObject({
  version: z.literal(1),
  app: z
    .strictObject({
      timezone: z.string().min(1).optional(),
      public_deployment: z.boolean().optional(),
      world_simulator: z
        .strictObject({
          base_url: z.url({ protocol: /^https?$/ }).optional(),
        })
        .optional(),
    })
    .optional(),
  database: z
    .strictObject({
      mongo_uri: z.string().min(1).optional(),
      redis_url: z.string().min(1).optional(),
      sync_mongo_uri: z.string().min(1).optional(),
      sync_redis_url: z.string().min(1).optional(),
      qdrant: z.strictObject({ base_url: z.url() }).optional(),
    })
    .optional(),
  llm: z
    .strictObject({
      models: z
        .strictObject({
          chat: model_group_schema.optional(),
          strong: model_group_schema.optional(),
          flash: model_group_schema.optional(),
          multimodal: model_group_schema
            .extend({
              providers: z.array(
                model_group_schema.shape.providers.element.extend({
                  input_modalities: z.array(z.enum(["image", "audio", "video"])).min(1),
                }),
              ),
            })
            .optional(),
          embedding: z
            .strictObject({
              dimensions: z.number().int().positive().optional(),
              providers: z.array(provider_schema),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  characters: z
    .record(
      z.string().min(1),
      z.strictObject({
        name: z.string().min(1),
        nicknames: z.array(z.string().min(1)).optional(),
        onebot: z
          .strictObject({
            self_id: z.string().min(1),
            endpoint: z.url({ protocol: /^wss?$/ }),
            token: z.string().optional(),
            group_white_list: z.array(z.string().min(1)).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export type Config = z.infer<typeof config_schema>;
