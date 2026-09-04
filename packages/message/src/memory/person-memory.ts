import { SUBJECT_NAME } from "@yuiju/utils/constants/character";
import { getRecentMemoryEpisodes } from "@yuiju/utils/db/operations/memory-episode";
import type { IMemoryEpisode } from "@yuiju/utils/db/schema/memory-episode.schema";
import type { PersonMemoryUpdateInput } from "@yuiju/utils/memory/person-memory/types";
import { updatePersonMemory } from "@yuiju/utils/memory/person-memory/update";
import { formatProjectTime } from "@yuiju/utils/time";
import type { ConversationEpisodePayload } from "./episode-builder";

interface DailyConversationMaterial {
  sessionLabel: string;
  windowStart: string;
  windowEnd: string;
  summary: string;
}

interface DailyPersonMemoryCandidate {
  nickname: string;
  scene: PersonMemoryUpdateInput["scene"];
  interactionCount: number;
  conversations: DailyConversationMaterial[];
}

export async function updateDailyPersonMemories(input: {
  diaryDate: Date;
  isDev: boolean;
}): Promise<void> {
  const episodes = await getRecentMemoryEpisodes({
    limit: 0,
    sources: ["chat"],
    types: ["conversation"],
    subject: SUBJECT_NAME,
    isDev: input.isDev,
    onlyDate: input.diaryDate,
    sortDirection: "asc",
  });
  const candidates = buildDailyPersonMemoryCandidates(episodes);

  for (const candidate of candidates) {
    await updatePersonMemory({
      nickname: candidate.nickname,
      scene: candidate.scene,
      interactionCount: candidate.interactionCount,
      interactionMaterial: buildDailyInteractionMaterial(input.diaryDate, candidate),
    });
  }
}

function buildDailyPersonMemoryCandidates(
  episodes: IMemoryEpisode[],
): DailyPersonMemoryCandidate[] {
  const candidateBySceneAndNickname = new Map<string, DailyPersonMemoryCandidate>();

  for (const episode of episodes) {
    const payload = episode.payload as unknown as ConversationEpisodePayload;
    const conversation: DailyConversationMaterial = {
      sessionLabel: payload.counterpartyName,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      summary: episode.summaryText,
    };

    if (payload.scene === "private") {
      const interactionCount = payload.messages.filter((message) => !message.isSelf).length;
      if (interactionCount > 0) {
        appendDailyPersonMemoryCandidate(candidateBySceneAndNickname, {
          nickname: payload.counterpartyName,
          scene: payload.scene,
          interactionCount,
          conversation,
        });
      }
      continue;
    }

    const interactionCountByNickname = new Map<string, number>();
    for (const message of payload.messages) {
      const nickname = message.speaker_name.trim();
      if (message.isSelf || !nickname) {
        continue;
      }

      interactionCountByNickname.set(nickname, (interactionCountByNickname.get(nickname) ?? 0) + 1);
    }

    for (const [nickname, interactionCount] of interactionCountByNickname) {
      appendDailyPersonMemoryCandidate(candidateBySceneAndNickname, {
        nickname,
        scene: payload.scene,
        interactionCount,
        conversation,
      });
    }
  }

  return [...candidateBySceneAndNickname.values()];
}

function appendDailyPersonMemoryCandidate(
  candidateBySceneAndNickname: Map<string, DailyPersonMemoryCandidate>,
  input: {
    nickname: string;
    scene: PersonMemoryUpdateInput["scene"];
    interactionCount: number;
    conversation: DailyConversationMaterial;
  },
) {
  const key = `${input.scene}:${input.nickname}`;
  const candidate = candidateBySceneAndNickname.get(key);
  if (candidate) {
    candidate.interactionCount += input.interactionCount;
    candidate.conversations.push(input.conversation);
    return;
  }

  candidateBySceneAndNickname.set(key, {
    nickname: input.nickname,
    scene: input.scene,
    interactionCount: input.interactionCount,
    conversations: [input.conversation],
  });
}

function buildDailyInteractionMaterial(
  diaryDate: Date,
  candidate: DailyPersonMemoryCandidate,
): string {
  return [
    `场景：${candidate.scene === "private" ? "私聊" : "群聊"}`,
    `当前正在判断的人物：${candidate.nickname}`,
    `日期：${formatProjectTime(diaryDate, "YYYY-MM-DD")}`,
    "当天相关对话：",
    JSON.stringify(candidate.conversations, null, 2),
  ].join("\n");
}
