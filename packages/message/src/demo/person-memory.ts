import "@yuiju/utils/env";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getPersonMemory,
  getPersonMemoryFilePath,
  getYuijuConfig,
  updatePersonMemory,
} from "@yuiju/utils";
import type { ChatWindowState } from "../memory/person-memory";
import { buildGroupPersonMemoryUpdateInputs } from "../memory/person-memory";
import type { StoredGroupMessage } from "../utils/message";

const TARGET_GROUP_ID = 1083608109;

function getSnapshotPath() {
  return resolve(getYuijuConfig().app.memoryDir, "demo", `group-history-${TARGET_GROUP_ID}.json`);
}

async function readChatWindowSnapshot(): Promise<ChatWindowState<StoredGroupMessage>> {
  const snapshotPath = getSnapshotPath();
  const content = await readFile(snapshotPath, "utf8");
  const parsed = JSON.parse(content) as ChatWindowState<StoredGroupMessage>;

  if (!parsed.messages?.length) {
    throw new Error(`群聊窗口快照为空：${snapshotPath}`);
  }

  return parsed;
}

export async function main() {
  const state = await readChatWindowSnapshot();
  const updateInputs = buildGroupPersonMemoryUpdateInputs(state);

  if (!updateInputs.length) {
    console.log("\n未识别出可更新人物记忆的候选对象。");
    return;
  }

  for (const updateInput of updateInputs) {
    console.log("\n=== CANDIDATE ===");
    console.log(`personId: ${updateInput.personId}`);
    console.log(`displayName: ${updateInput.displayName}`);
    console.log("\n=== INTERACTION MATERIAL ===\n");

    const result = await updatePersonMemory(updateInput);

    console.log("\n=== UPDATE RESULT ===\n");
    console.log(JSON.stringify(result, null, 2));

    const memory = await getPersonMemory(updateInput.personId);
    const filePath = await getPersonMemoryFilePath(updateInput.personId);

    if (!memory) {
      console.log(`\n未读取到人物记忆文件：${filePath}`);
      continue;
    }

    console.log("\n=== MEMORY FILE ===\n");
    console.log(filePath);
    console.log("\n=== MEMORY CONTENT ===\n");
    console.log(JSON.stringify(memory.memory, null, 2));
  }
}
