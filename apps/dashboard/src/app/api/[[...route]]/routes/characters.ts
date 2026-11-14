import type { EmotionStatus, WorldStatus } from "@yuiju/shared/dashboard/types";
import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import { Hono } from "hono";
import { getDeployment } from "@/lib/deployment";
import { getQueryCharacter } from "../character-query";

export type CharacterStatus = {
  name: string;
  timezone: string;
  publicDeployment: boolean;
  world: WorldStatus | null;
  emotion: EmotionStatus | null;
  feelings?: { content: string; occurredAt: number }[];
};

export const charactersApi = new Hono().get("/", async (c) => {
  const deployment = await getDeployment();
  const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
  const { source, publicDeployment } = deployment;
  const characterId = character.id;
  const redis = await getRedis(source);
  const prefix = redisKeyPrefix();
  const characterKey = `${prefix}character:${encodeURIComponent(characterId)}`;
  const [world, emotion] = await redis.mget(
    `${prefix}dashboard:world:${encodeURIComponent(characterId)}`,
    publicDeployment
      ? `${prefix}dashboard:emotion:${encodeURIComponent(characterId)}`
      : `${characterKey}:emotion:state`,
  );
  const storedEmotion = emotion === null ? null : JSON.parse(emotion);
  const status: CharacterStatus = {
    name: character.name,
    timezone: deployment.timezone,
    publicDeployment,
    world: world === null ? null : JSON.parse(world),
    emotion:
      storedEmotion === null
        ? null
        : {
            pleasure: storedEmotion.pleasure,
            activation: storedEmotion.activation,
            control: storedEmotion.control,
            updatedAt: storedEmotion.updatedAt,
          },
  };
  if (!publicDeployment) {
    status.feelings = storedEmotion === null ? [] : storedEmotion.feelings;
  }
  return c.json(status);
});
