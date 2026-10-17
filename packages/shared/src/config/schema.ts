import { z } from "zod";

const extensionNameSchema = z.string().regex(/^yuiju-[a-z0-9][a-z0-9._-]*$/);

/** 配置允许简写群号；业务侧统一使用对象，只有显式开启才采集训练数据。 */
const groupWhitelistSchema = z
  .array(
    z
      .union([
        z.string().min(1),
        z.strictObject({
          group_id: z.string().min(1),
          collect_training_data: z.boolean().optional(),
        }),
      ])
      .transform((group) => ({
        group_id: typeof group === "string" ? group : group.group_id,
        collect_training_data: typeof group !== "string" && group.collect_training_data === true,
      })),
  )
  .superRefine((groups, context) => {
    const groupIds = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (groupIds.has(group.group_id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "群白名单不能重复配置同一个群",
        });
      }
      groupIds.add(group.group_id);
    }
  });

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

export const config_schema = z
  .strictObject({
    version: z.literal(1),
    extensions: z
      .array(extensionNameSchema)
      .refine((names) => new Set(names).size === names.length, "扩展包不能重复登记")
      .optional(),
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
          extensions: z
            .record(extensionNameSchema, z.strictObject({ enabled: z.boolean().optional() }))
            .optional(),
          onebot: z
            .strictObject({
              self_id: z.string().min(1),
              endpoint: z.url({ protocol: /^wss?$/ }),
              token: z.string().optional(),
              group_white_list: groupWhitelistSchema.optional(),
            })
            .optional(),
        }),
      )
      .optional(),
  })
  .superRefine((config, context) => {
    for (const [characterId, character] of Object.entries(config.characters ?? {})) {
      for (const name of Object.keys(character.extensions ?? {})) {
        if (!config.extensions?.includes(name)) {
          context.addIssue({
            code: "custom",
            path: ["characters", characterId, "extensions", name],
            message: "角色扩展必须先在顶层 extensions 登记",
          });
        }
      }
    }
  });

export type Config = z.infer<typeof config_schema>;
