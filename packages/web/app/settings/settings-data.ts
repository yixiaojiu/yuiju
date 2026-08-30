import "server-only";

import { getYuijuConfig } from "@yuiju/utils/config/config";
import {
  countRecentMemoryEpisodes,
  getRecentMemoryEpisodes,
} from "@yuiju/utils/db/operations/memory-episode";
import { isDev } from "@yuiju/utils/env";
import { listPersonMemories } from "@yuiju/utils/memory/person-memory/directory";
import { readPersonMemoryHeatDocument } from "@yuiju/utils/memory/person-memory/heat";
import { getRedis } from "@yuiju/utils/redis/client";

export type ServiceStatus = "online" | "offline";

export interface SettingsSnapshot {
  generatedAt: string;
  environment: "development" | "production";
  chat: {
    enabled: boolean;
    identity: string;
    model: string;
  };
  message: {
    status: ServiceStatus;
  };
  mongo: {
    status: ServiceStatus;
    episodeCount: number | null;
    latestArchiveAt: string | null;
  };
  redis: {
    status: ServiceStatus;
  };
  personMemory: {
    status: ServiceStatus;
    count: number | null;
    interactionHeat: number | null;
  };
}

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const config = getYuijuConfig();
  const ownerName = config.message.web.ownerName;

  const mongoPromise = (async () => {
    try {
      const [episodeCount, latestEpisodes] = await Promise.all([
        countRecentMemoryEpisodes({ sources: ["chat"], types: ["conversation"] }),
        getRecentMemoryEpisodes({
          sources: ["chat"],
          types: ["conversation"],
          limit: 1,
          sortField: "createdAt",
        }),
      ]);
      const latestArchive = latestEpisodes[0];

      return {
        status: "online" as const,
        episodeCount,
        latestArchiveAt: latestArchive?.createdAt.toISOString() ?? null,
      };
    } catch {
      return {
        status: "offline" as const,
        episodeCount: null,
        latestArchiveAt: null,
      };
    }
  })();

  const redisPromise = (async () => {
    try {
      await getRedis().ping();
      return { status: "online" as const };
    } catch {
      return { status: "offline" as const };
    }
  })();

  const messagePromise = (async () => {
    if (!config.message.web.enabled) {
      return { status: "offline" as const };
    }

    try {
      const { host, port } = config.message.internalApi;
      const response = await fetch(`http://${host}:${port}/internal/web/messages?limit=1`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      return { status: response.ok ? ("online" as const) : ("offline" as const) };
    } catch {
      return { status: "offline" as const };
    }
  })();

  const personMemoryPromise = (async () => {
    try {
      const [directory, heatDocument] = await Promise.all([
        listPersonMemories(1),
        readPersonMemoryHeatDocument(),
      ]);
      return {
        status: "online" as const,
        count: directory.total,
        interactionHeat: heatDocument[ownerName]?.heat ?? 0,
      };
    } catch {
      return {
        status: "offline" as const,
        count: null,
        interactionHeat: null,
      };
    }
  })();

  const [mongo, redis, message, personMemory] = await Promise.all([
    mongoPromise,
    redisPromise,
    messagePromise,
    personMemoryPromise,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    environment: isDev() ? "development" : "production",
    chat: {
      enabled: config.message.web.enabled,
      identity: ownerName,
      model: config.llm.models.chat[0].model,
    },
    message,
    mongo,
    redis,
    personMemory,
  };
}
