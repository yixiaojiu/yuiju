import { formatProjectTime } from "../time";
import type { ActionId } from "../types/action";
import type { CharacterStateData, WorldStateData } from "../types/state";

export interface BuildProactiveGroupMessagePromptInput {
  action: ActionId;
  shareReason: string;
  actionSummaryText: string;
  characterStateSnapshot: CharacterStateData;
  worldStateSnapshot: WorldStateData;
  groupContext: {
    groupLabel: string;
    historyJson: string;
  };
}

export function buildProactiveGroupMessagePrompt(
  input: BuildProactiveGroupMessagePromptInput,
): string {
  const characterStateSnapshot = {
    location: input.characterStateSnapshot.location,
    stamina: input.characterStateSnapshot.stamina,
    satiety: input.characterStateSnapshot.satiety,
    mood: input.characterStateSnapshot.mood,
  };
  const worldStateSnapshot = {
    time: formatProjectTime(input.worldStateSnapshot.time, "YYYY-MM-DD HH:mm:ss"),
    weather: input.worldStateSnapshot.weather
      ? {
          type: input.worldStateSnapshot.weather.type,
          temperatureLevel: input.worldStateSnapshot.weather.temperatureLevel,
        }
      : null,
  };

  return `
## 主动分享任务

你在行动决策时已经产生了想分享生活事件的意图。你现在只需要根据目标群聊上下文，判断此刻是否适合把这件事发到群里，并生成最终群消息。

## 分享意图

${input.shareReason}

## Action 完成事实

Action：${input.action}
完成摘要：${input.actionSummaryText}

## 当前角色状态

\`\`\`json
${JSON.stringify(characterStateSnapshot, null, 2)}
\`\`\`

## 当前世界状态

\`\`\`json
${JSON.stringify(worldStateSnapshot, null, 2)}
\`\`\`

## 目标群聊

群聊：${input.groupContext.groupLabel}

最近群聊消息：
\`\`\`json
${input.groupContext.historyJson}
\`\`\`

## 判断要求

- 以“当前世界状态”中的时间作为当前时间，读取“最近群聊消息”中时间最新的一条消息。
- 如果最近几条消息主要是你连续分享生活状态，且没有人回应、追问或展开新话题，shouldSend=false；群聊之后变安静也不能覆盖这条判断。
- 否则，如果最近群聊消息为空、最新消息距离当前时间超过 30 分钟，或当前话题能够自然接入这次分享，可以 shouldSend=true。
- 如果分享与当前话题无关、插入会显得突兀，或拿不准是否适合发送，shouldSend=false。

## 群消息生成要求

- 像刚经历完这件事后在普通朋友群里顺手提一句，默认只说一个具体事实、状态或轻微吐槽。
- 参考最近群聊里真实消息的粒度：可以是短句、半句或省略主语的话，不需要交代完整的时间、地点、过程和心情。
- 如果最值得说的只是一个结果，说出结果就停；不要为了显得有生活感再补环境描写和感受。
- 不要写成刻意营造氛围的日记、散文、朋友圈文案、总结或泛泛抒情。
- 不要复述 Action、分享意图等内部信息，把它们转成自然的生活表达。

口吻示例只用于校准粒度，不要照抄示例中的事实：
- 做饭时分量没控制好：“咖喱做多了（”
- 应用崩溃后改去实地看夜景：“云旅游又崩了，结果真跑出去看夜景了”
- 吃到期待的食物：“总算吃上了”
`.trim();
}
