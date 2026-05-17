import { formatProjectTime } from "../time";
import type { ActionId, CharacterStateData, WorldStateData } from "../types";

export interface BuildProactiveGroupMessagePromptInput {
  action: ActionId;
  shareReason: string;
  eventDescription?: string;
  completionContext?: Record<string, unknown>;
  characterStateSnapshot: CharacterStateData;
  worldStateSnapshot: WorldStateData;
  groupContext: {
    groupLabel: string;
    summary?: string;
    historyJson: string;
  };
}

export function buildProactiveGroupMessagePrompt(
  input: BuildProactiveGroupMessagePromptInput,
): string {
  const worldStateSnapshot = {
    ...input.worldStateSnapshot,
    time: formatProjectTime(input.worldStateSnapshot.time, "YYYY-MM-DD HH:mm:ss"),
  };

  return `
## 主动分享任务

你在行动决策时已经产生了想分享生活事件的意图。你现在只需要根据目标群聊上下文，判断此刻是否适合把这件事发到群里，并生成最终群消息。

## 分享意图

${input.shareReason}

## Action 完成事实

Action：${input.action}
事件描述：${input.eventDescription ?? "无"}
完成上下文：
\`\`\`json
${JSON.stringify(input.completionContext ?? {}, null, 2)}
\`\`\`

## 当前角色状态

\`\`\`json
${JSON.stringify(input.characterStateSnapshot, null, 2)}
\`\`\`

## 当前世界状态

\`\`\`json
${JSON.stringify(worldStateSnapshot, null, 2)}
\`\`\`

## 目标群聊

群聊：${input.groupContext.groupLabel}

最近群聊摘要：
${input.groupContext.summary ?? "无"}

最近群聊消息：
\`\`\`json
${input.groupContext.historyJson}
\`\`\`

## 判断要求

- 以“当前世界状态”中的时间作为当前时间，读取“最近群聊消息”中时间最新的一条消息。
- 如果最近群聊消息为空，或最新消息距离当前时间已经超过 10 分钟，说明群聊当前已经安静；只要这件生活事件本身适合自然分享，就可以 shouldSend=true。
- 如果群聊正在聊完全无关且插入会突兀，shouldSend=false。
`.trim();
}
