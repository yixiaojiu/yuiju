import "@yuiju/utils/env";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getYuijuConfig } from "@yuiju/utils";
import { NCWebsocket } from "node-napcat-ts";
import { stickerState } from "../state/sticker";
import type { ChatWindowState } from "../memory/person-memory";
import {
  createStoredGroupMessageFromFetched,
  getGroupDisplayName,
  type StoredGroupMessage,
} from "../utils/message";

const TARGET_GROUP_ID = 1083608109;
const MESSAGE_COUNT = 15;

function getOutputPath() {
  return resolve(getYuijuConfig().app.memoryDir, "demo", `group-history-${TARGET_GROUP_ID}.json`);
}

export async function main() {
  const napcat = new NCWebsocket(getYuijuConfig().message.napcat);

  try {
    await stickerState.initialize();
    await napcat.connect();

    const result = await napcat.get_group_msg_history({
      group_id: TARGET_GROUP_ID,
      count: MESSAGE_COUNT,
    });

    const fetchedMessages = result.messages
      .filter(
        (
          message,
        ): message is Extract<(typeof result.messages)[number], { message_type: "group" }> => {
          return message.message_type === "group";
        },
      )
      .sort((left, right) => left.time - right.time);

    if (!fetchedMessages.length) {
      throw new Error(`未拉取到群 ${TARGET_GROUP_ID} 的群聊消息。`);
    }

    const messages = await Promise.all(
      fetchedMessages.map((message) => createStoredGroupMessageFromFetched(message, napcat)),
    );

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    const chatWindow: ChatWindowState<StoredGroupMessage> = {
      sessionLabel: getGroupDisplayName(firstMessage),
      windowStartMs: firstMessage.time * 1000,
      lastTsMs: lastMessage.time * 1000,
      messages,
    };

    const outputPath = getOutputPath();

    await mkdir(dirname(outputPath), {
      recursive: true,
    });
    await writeFile(outputPath, `${JSON.stringify(chatWindow, null, 2)}\n`, "utf8");

    console.log("=== GROUP HISTORY DEMO ===");
    console.log(`groupId: ${TARGET_GROUP_ID}`);
    console.log(`sessionLabel: ${chatWindow.sessionLabel}`);
    console.log(`messageCount: ${chatWindow.messages.length}`);
    console.log(`output: ${outputPath}`);
  } finally {
    await napcat.disconnect().catch(() => undefined);
  }
}
