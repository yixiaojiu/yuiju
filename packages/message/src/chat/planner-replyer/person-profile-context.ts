import { NICKNAME, SUBJECT_NAME } from "@yuiju/utils/constants/character";
import { getPersonMemory } from "@yuiju/utils/memory/person-memory/storage";
import { PERSON_MEMORY_SECTION_KEYS } from "@yuiju/utils/memory/person-memory/types";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

const PROFILE_LIMIT = 3;

export async function buildPersonProfileContext(
  messages: readonly StoredSatoriGroupMessage[],
): Promise<string> {
  const nicknames: string[] = [];
  const seen = new Set<string>([SUBJECT_NAME, NICKNAME]);

  const currentMessage = messages.at(-1);
  if (currentMessage) {
    collectMessageNicknames(currentMessage, seen, nicknames);
  }

  for (
    let index = messages.length - 2;
    index >= 0 && nicknames.length < PROFILE_LIMIT;
    index -= 1
  ) {
    collectMessageNicknames(messages[index], seen, nicknames);
  }

  const profiles: string[] = [];
  for (const nickname of nicknames.slice(0, PROFILE_LIMIT)) {
    const memory = await getPersonMemory(nickname);
    if (!memory) {
      continue;
    }

    profiles.push(
      [`【${memory.nickname}】`]
        .concat(
          PERSON_MEMORY_SECTION_KEYS.map((section) => `${section}：${memory.sections[section]}`),
        )
        .join("\n"),
    );
  }

  return profiles.length ? `【人物画像-内部参考】\n${profiles.join("\n\n")}` : "";
}

function collectMessageNicknames(
  message: StoredSatoriGroupMessage,
  seen: Set<string>,
  nicknames: string[],
): void {
  addNickname(message.sender.displayName, seen, nicknames);
  if (nicknames.length >= PROFILE_LIMIT) {
    return;
  }

  for (const segment of message.content) {
    if (segment.type === "at") {
      addNickname(segment.data.displayName, seen, nicknames);
    }

    if (nicknames.length >= PROFILE_LIMIT) {
      return;
    }
  }

  for (const segment of message.content) {
    if (segment.type === "reply" && segment.data.speaker) {
      addNickname(segment.data.speaker, seen, nicknames);
    }

    if (nicknames.length >= PROFILE_LIMIT) {
      return;
    }
  }
}

function addNickname(nickname: string, seen: Set<string>, nicknames: string[]): void {
  const value = nickname.trim();
  if (!value || seen.has(value)) {
    return;
  }

  seen.add(value);
  nicknames.push(value);
}
