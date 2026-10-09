import { randomUUID } from "node:crypto";
import { test, vi } from "vitest";
import type { ConversationMessage, IncomingEvent } from "../src/conversation/message";
import { OneBotConnection } from "../src/conversation/onebot";
import { Planner } from "../src/conversation/planner";
import { Replyer } from "../src/conversation/replyer";
import type { ConversationToolContext } from "../src/conversation/tools";
import { evaluateTrigger, isDirectedMessage } from "../src/conversation/trigger";
import { conversationCases, conversationState } from "./cases/conversation";
import { runEvaluation } from "./fixtures";
import { record } from "./report";

for (const scenario of conversationCases) {
  test(scenario.title, async () => {
    await runEvaluation(
      scenario,
      { ...scenario, characterState: conversationState, memories: "无相关记录", plans: [] },
      async () => {
        const scope = { characterId: "yuuno", platform: "onebot" as const, channelId: "20001" };
        const history: ConversationMessage[] = [];
        const planner = new Planner(scope);
        const replyer = new Replyer(scope);
        const connection = new OneBotConnection("悠乃", {
          self_id: "90001",
          endpoint: "ws://eval.invalid",
        });
        const self = { senderId: "90001", senderName: "悠乃", isSelf: true };
        let sentCount = 0;
        vi.spyOn(connection, "sendText").mockImplementation(async (_channelId, content, target) => {
          const event: IncomingEvent = {
            ...self,
            kind: "message",
            id: `sent-${++sentCount}`,
            content,
            timestamp: Date.now(),
            mentionedSenderId: target.senderId,
            ...(target.quoteMessageId ? { quote: { id: target.quoteMessageId } } : {}),
          };
          record("effect", "QQ 发送文字（模拟确认）", event);
          return [event];
        });
        vi.spyOn(connection, "poke").mockImplementation(async (_channelId, targetSenderId) => {
          const event: IncomingEvent = {
            ...self,
            kind: "poke",
            timestamp: Date.now(),
            targetSenderId,
          };
          record("effect", "QQ 戳一戳（模拟确认）", event);
          return event;
        });
        await planner.initialize({ history: [], summary: { text: "", coveredThrough: 0 } });
        await replyer.initialize({ text: "", coveredThrough: 0 });
        try {
          for (const [batchIndex, batch] of scenario.batches.entries()) {
            vi.setSystemTime(new Date(new Date(scenario.time).getTime() + batchIndex * 30_000));
            const messages: ConversationMessage[] = batch.map((message, index) => ({
              ...message,
              kind: "message",
              id: `input-${batchIndex}-${index}`,
              sequence: history.length + index + 1,
              timestamp: Date.now(),
              isSelf: false,
            }));
            history.push(...messages);
            planner.appendInput(messages);
            const trigger = evaluateTrigger({
              pending: messages,
              history,
              directed: messages.some((message) =>
                isDirectedMessage(message, "90001", ["悠乃", "悠酱"]),
              ),
              nextEligibleAt: 0,
              now: Date.now(),
            });
            record("effect", `第 ${batchIndex + 1} 批输入与 trigger`, { messages, trigger });
            if (!trigger.shouldRun) {
              continue;
            }
            const execution: ConversationToolContext = {
              canParticipate: () => true,
              readCharacter: async () => conversationState,
              notifyCharacter: async (description, messageIds, relatedEventId) => {
                if (relatedEventId) {
                  return "未投递：本次输入中没有主 loop 事件。";
                }
                const id = randomUUID();
                record("effect", "向主 loop 提交交流（内存）", { id, description, messageIds });
                return `已投递给主 loop，事件 ID：${id}。尚不代表已作出决定。`;
              },
              connection,
              replyer,
              history,
              historyThrough: history.length,
              recordSent: async (events) => {
                for (const event of events) {
                  history.push({ ...event, sequence: history.length + 1 });
                }
              },
              beforeSend: async () => {},
              saveReplyerSummary: async () => {},
              sendAttempted: false,
              failed: false,
            };
            await planner.run(execution, async () => {});
          }
        } finally {
          await planner.stop();
          await replyer.stop();
        }
      },
    );
  });
}
