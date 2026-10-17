import { load_config } from "@yuiju/shared/config/load";
import {
  readConversationSettings,
  saveConversationSetting,
} from "@yuiju/shared/dashboard/conversation-settings";
import { Hono } from "hono";
import { z } from "zod";
import { getDeployment } from "@/lib/deployment";

export type ConversationSettingsResponse = {
  characters: { id: string; name: string; groups: { groupId: string; enabled: boolean }[] }[];
};

const updateSchema = z.object({
  characterId: z.string().min(1),
  groupId: z.string().min(1),
  enabled: z.boolean(),
});

export const conversationSettingsApi = new Hono()
  .use("*", async (c, next) => {
    if ((await getDeployment()).publicDeployment) {
      return c.notFound();
    }
    await next();
  })
  .get("/", async (c) => {
    const config = await load_config();
    const characters = await Promise.all(
      Object.entries(config.characters!).map(async ([id, character]) => {
        const settings = await readConversationSettings(id);
        return {
          id,
          name: character.name,
          groups: (character.onebot?.group_white_list ?? []).map((group) => ({
            groupId: group.group_id,
            enabled: settings[group.group_id] ?? true,
          })),
        };
      }),
    );
    return c.json({ characters } satisfies ConversationSettingsResponse);
  })
  .patch("/", async (c) => {
    const input = updateSchema.safeParse(await c.req.json());
    if (!input.success) {
      return c.json({ error: "会话开关参数无效" }, 400);
    }
    const { characterId, groupId, enabled } = input.data;
    const config = await load_config();
    const character = config.characters![characterId];
    if (!character?.onebot?.group_white_list?.some((group) => group.group_id === groupId)) {
      return c.json({ error: "该角色未配置此 QQ 群" }, 400);
    }
    await saveConversationSetting(characterId, groupId, enabled);
    return c.json({ enabled });
  });
