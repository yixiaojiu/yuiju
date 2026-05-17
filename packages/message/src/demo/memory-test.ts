import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getYuijuProjectRoot, SUBJECT_NAME } from "@yuiju/utils";
import { llmManager } from "@/llm/manager";
import { stickerState } from "@/state/sticker";
import { getProtocolMessageSenderName, type StoredGroupMessage } from "@/utils/message";

interface GroupHistoryDemoFile {
  sessionLabel: string;
  messages: StoredGroupMessage[];
}

export async function main() {
  await stickerState.initialize();

  const demoFilePath = resolve(getYuijuProjectRoot(), "memory/demo/group-history-1083608109.json");
  const demoFile = JSON.parse(await readFile(demoFilePath, "utf8")) as GroupHistoryDemoFile;
  const messages = demoFile.messages
    .slice()
    .sort((left, right) => left.time - right.time || left.message_seq - right.message_seq);

  if (!messages.length) {
    throw new Error(`测试数据里没有群消息：${demoFilePath}`);
  }

  for (const message of messages) {
    for (const segment of message.message) {
      if (segment.type !== "at") {
        continue;
      }

      const data = segment.data as Record<string, unknown>;
      data.displayName = data.qq === String(message.self_id) ? SUBJECT_NAME : String(data.qq);
      data.isSelf = data.qq === String(message.self_id);
    }

    llmManager.recordGroupMessage(message, demoFile.sessionLabel);
  }

  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    throw new Error("无法读取最后一条群消息。");
  }

  const result = await llmManager.chatInGroup(latestMessage, "at");

  console.log(JSON.stringify({ result }, null, 2));
}
