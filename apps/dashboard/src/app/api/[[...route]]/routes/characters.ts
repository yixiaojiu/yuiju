import type { EmotionStatus, WorldStatus } from "@yuiju/shared/dashboard/types";
import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import { Hono } from "hono";
import { getDeployment } from "@/lib/deployment";

export type CharacterStatus = {
  name: string;
  timezone: string;
  publicDeployment: boolean;
  world: WorldStatus | null;
  emotion: EmotionStatus | null;
  feelings?: { content: string; occurredAt: number }[];
  plans?: {
    id: string;
    content: string;
    background: string;
    progress: string;
    status: string;
    plannedAt: number | null;
  }[];
};

export const charactersApi = new Hono().get("/", async (c) => {
  const deployment = await getDeployment();
  const { characterId, source, publicDeployment } = deployment;
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
    name: deployment.name,
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
    status.plans = Object.values(await redis.hgetall(`${characterKey}:plans`)).map((value) =>
      JSON.parse(value),
    );
  }
  return c.json(status);
});
