import type { PersonMemoryUpdateInput } from "@yuiju/utils";
import { getTimeWithWeekday, updatePersonMemory } from "@yuiju/utils";
import dayjs from "dayjs";
import {
  getProtocolMessageSenderName,
  projectHistoryMessageContent,
  type StoredGroupMessage,
  type StoredPrivateMessage,
  type StoredProtocolMessage,
} from "../utils/message";

export interface ChatWindowState<TMessage extends StoredProtocolMessage> {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: TMessage[];
}

interface ChatWindowTranscriptItem {
  messageId: number;
  speaker: string;
  speakerUserId: number;
  time: string;
  content: ReturnType<typeof projectHistoryMessageContent>;
}

interface GroupPersonCandidate {
  personId: string;
  nickname: string;
  interactionCount: number;
}

export function buildPrivatePersonMemoryUpdateInput(
  state: ChatWindowState<StoredPrivateMessage>,
): PersonMemoryUpdateInput | null {
  const counterpartyUserId = state.messages[0]?.user_id;
  if (!counterpartyUserId) {
    return null;
  }

  return {
    personId: String(counterpartyUserId),
    nickname: state.sessionLabel,
    interactionCount: state.messages.filter(
      (message) => message.sender.user_id === counterpartyUserId,
    ).length,
    interactionMaterial: buildInteractionMaterial({
      scene: "private",
      sessionLabel: state.sessionLabel,
      windowStartMs: state.windowStartMs,
      lastTsMs: state.lastTsMs,
      messages: state.messages,
    }),
    scene: "private",
  };
}

export function buildGroupPersonMemoryUpdateInputs(
  state: ChatWindowState<StoredGroupMessage>,
): PersonMemoryUpdateInput[] {
  const candidateByPersonId = new Map<string, GroupPersonCandidate>();

  for (const message of state.messages) {
    if (message.sender.user_id === message.self_id) {
      continue;
    }

    const personId = String(message.sender.user_id);
    const existingCandidate = candidateByPersonId.get(personId);

    candidateByPersonId.set(personId, {
      personId,
      nickname: getProtocolMessageSenderName(message),
      interactionCount: existingCandidate ? existingCandidate.interactionCount + 1 : 1,
    });
  }

  return Array.from(candidateByPersonId.values()).map((candidate) => ({
    personId: candidate.personId,
    nickname: candidate.nickname,
    interactionCount: candidate.interactionCount,
    interactionMaterial: buildInteractionMaterial({
      scene: "group",
      sessionLabel: state.sessionLabel,
      windowStartMs: state.windowStartMs,
      lastTsMs: state.lastTsMs,
      messages: state.messages,
      candidate,
    }),
    scene: "group",
  }));
}

export async function writePersonMemoryUpdatesForPrivateChatWindow(
  state: ChatWindowState<StoredPrivateMessage>,
): Promise<void> {
  const updateInput = buildPrivatePersonMemoryUpdateInput(state);
  if (!updateInput) {
    return;
  }

  await updatePersonMemory(updateInput);
}

export async function writePersonMemoryUpdatesForGroupChatWindow(
  state: ChatWindowState<StoredGroupMessage>,
): Promise<void> {
  const updateInputs = buildGroupPersonMemoryUpdateInputs(state);
  for (const updateInput of updateInputs) {
    await updatePersonMemory(updateInput);
  }
}

function buildInteractionMaterial(input: {
  scene: "private" | "group";
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: StoredProtocolMessage[];
  candidate?: GroupPersonCandidate;
}): string {
  const transcript = input.messages.map((message) => buildTranscriptItem(message));
  const sceneLabel = input.scene === "private" ? "私聊" : "群聊";
  const candidateText = input.candidate
    ? `\n当前正在判断的人物：${input.candidate.nickname}（${input.candidate.personId}）`
    : "";

  return [
    `场景：${sceneLabel}`,
    `会话：${input.sessionLabel}${candidateText}`,
    `时间范围：${getTimeWithWeekday(dayjs(input.windowStartMs))} 至 ${getTimeWithWeekday(dayjs(input.lastTsMs))}`,
    "对话材料：",
    JSON.stringify(transcript, null, 2),
  ].join("\n");
}

function buildTranscriptItem(message: StoredProtocolMessage): ChatWindowTranscriptItem {
  return {
    messageId: message.message_id,
    speaker: getProtocolMessageSenderName(message),
    speakerUserId: message.sender.user_id,
    time: getTimeWithWeekday(dayjs.unix(message.time)),
    content: projectHistoryMessageContent(message.message),
  };
}
