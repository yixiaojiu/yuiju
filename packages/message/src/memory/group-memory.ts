import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildGroupMemoryUpdatePrompt,
  flashModel,
  formatProjectTime,
  generateStructuredOutput,
  getTimeWithWeekday,
  getYuijuConfig,
} from "@yuiju/utils";
import { Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import {
  getProtocolMessageId,
  getProtocolMessageSenderName,
  getProtocolMessageTimestampMs,
  projectStoredMessageContent,
  type StoredSatoriGroupMessage,
} from "@/utils/message";

export interface GroupMemoryDocument {
  sessionId: string;
  sessionLabel: string;
  lastUpdatedAt: string;
  groupAtmosphere: string;
  yuijuFeeling: string;
  replyGuidance: string;
  recentInteraction: string;
}

export interface GroupChatWindowState {
  sessionLabel: string;
  windowStartMs: number;
  lastTsMs: number;
  messages: StoredSatoriGroupMessage[];
}

interface GroupMemoryUpdateOutput {
  shouldUpdate: boolean;
  groupAtmosphere: string;
  yuijuFeeling: string;
  replyGuidance: string;
  recentInteraction: string;
}

const EMPTY_GROUP_MEMORY_FIELD = "（暂无）";

const groupMemoryUpdateSchema = z.strictObject({
  shouldUpdate: z.boolean().describe("这轮是否需要写回群聊记忆。"),
  groupAtmosphere: z.string().describe("群聊氛围的完整正文。"),
  yuijuFeeling: z.string().describe("悠酱对这个群的感受的完整正文。"),
  replyGuidance: z.string().describe("后续在这个群里的回复节奏建议。"),
  recentInteraction: z.string().describe("最近值得记住的群聊互动。"),
});

export async function getGroupMemory(sessionId: string): Promise<GroupMemoryDocument | null> {
  try {
    const content = await readFile(getGroupMemoryFilePath(sessionId), "utf8");
    return parseGroupMemoryJson(content);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getGroupMemoryPromptSection(input: {
  sessionId: string;
  sessionLabel: string;
}): Promise<string> {
  const memory = await getGroupMemory(input.sessionId);
  if (!memory) {
    return `
## 当前群聊长期感受
群聊：${input.sessionLabel}
当前还没有形成稳定群聊记忆。你需要根据最近会话判断是否自然参与，不要为了刷存在感而自言自语。
`.trim();
  }

  return `
## 当前群聊长期感受
群聊：${memory.sessionLabel}
群聊氛围：${memory.groupAtmosphere}
悠酱对这个群的感受：${memory.yuijuFeeling}
回复节奏建议：${memory.replyGuidance}
最近值得记住的群聊互动：${memory.recentInteraction}
`.trim();
}

export async function updateGroupMemoryForChatWindow(input: {
  sessionId: string;
  state: GroupChatWindowState;
}): Promise<void> {
  const existingMemory = await getGroupMemory(input.sessionId);
  const output = await generateGroupMemoryUpdate({
    sessionLabel: input.state.sessionLabel,
    existingMemory,
    interactionMaterial: buildGroupInteractionMaterial(input.state),
  });

  if (!output.shouldUpdate) {
    return;
  }

  const nextMemory: GroupMemoryDocument = {
    sessionId: input.sessionId,
    sessionLabel: input.state.sessionLabel,
    lastUpdatedAt: formatProjectTime(new Date(), "YYYY-MM-DDTHH:mm:ssZ"),
    groupAtmosphere: normalizeGroupMemoryField(output.groupAtmosphere),
    yuijuFeeling: normalizeGroupMemoryField(output.yuijuFeeling),
    replyGuidance: normalizeGroupMemoryField(output.replyGuidance),
    recentInteraction: normalizeGroupMemoryField(output.recentInteraction),
  };

  const filePath = getGroupMemoryFilePath(input.sessionId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(nextMemory, null, 2)}\n`, "utf8");
}

function getGroupMemoryFilePath(sessionId: string): string {
  return resolve(getYuijuConfig().app.memoryDir, "groups", `${encodeURIComponent(sessionId)}.json`);
}

function parseGroupMemoryJson(content: string): GroupMemoryDocument {
  const parsed = JSON.parse(content) as GroupMemoryDocument;
  return {
    sessionId: parsed.sessionId,
    sessionLabel: parsed.sessionLabel,
    lastUpdatedAt: parsed.lastUpdatedAt,
    groupAtmosphere: normalizeGroupMemoryField(parsed.groupAtmosphere),
    yuijuFeeling: normalizeGroupMemoryField(parsed.yuijuFeeling),
    replyGuidance: normalizeGroupMemoryField(parsed.replyGuidance),
    recentInteraction: normalizeGroupMemoryField(parsed.recentInteraction),
  };
}

function normalizeGroupMemoryField(value: string): string {
  const normalized = value.trim();
  return normalized || EMPTY_GROUP_MEMORY_FIELD;
}

async function generateGroupMemoryUpdate(input: {
  sessionLabel: string;
  existingMemory: GroupMemoryDocument | null;
  interactionMaterial: string;
}): Promise<GroupMemoryUpdateOutput> {
  const { output } = await generateStructuredOutput({
    model: flashModel,
    providerOptions: {
      flash: {
        enable_thinking: false,
      },
    },
    output: Output.object({
      schema: groupMemoryUpdateSchema,
    }),
    prompt: buildGroupMemoryUpdatePrompt({
      sessionLabel: input.sessionLabel,
      currentTime: formatProjectTime(new Date(), "YYYY-MM-DD"),
      existingMemoryText: input.existingMemory
        ? JSON.stringify(input.existingMemory, null, 2)
        : "（无，当前尚未建立群聊记忆）",
      interactionMaterial: input.interactionMaterial,
    }),
  });

  return output;
}

function buildGroupInteractionMaterial(state: GroupChatWindowState): string {
  const transcript = state.messages.map((message) => ({
    messageId: getProtocolMessageId(message),
    speaker: getProtocolMessageSenderName(message) || "未知用户",
    time: getTimeWithWeekday(dayjs(getProtocolMessageTimestampMs(message))),
    content: projectStoredMessageContent(message),
  }));

  return [
    `会话：${state.sessionLabel}`,
    `时间范围：${getTimeWithWeekday(dayjs(state.windowStartMs))} 至 ${getTimeWithWeekday(dayjs(state.lastTsMs))}`,
    "对话材料：",
    JSON.stringify(transcript, null, 2),
  ].join("\n");
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
