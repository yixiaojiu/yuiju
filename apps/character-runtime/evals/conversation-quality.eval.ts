import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { test, vi } from "vitest";
import type { ConversationAgentEvent } from "../src/communication";
import {
  type ConversationMessage,
  type IncomingEvent,
  renderMessage,
} from "../src/conversation/message";
import { OneBotConnection } from "../src/conversation/onebot";
import { Planner } from "../src/conversation/planner";
import { Replyer } from "../src/conversation/replyer";
import type { ConversationToolContext } from "../src/conversation/tools";
import { isDirectedMessage } from "../src/conversation/trigger";
import { participants } from "./cases/conversation-quality";
import { continuityCases } from "./cases/conversation-quality/continuity";
import { expressionCases } from "./cases/conversation-quality/expression";
import { participationCases } from "./cases/conversation-quality/participation";
import { personaCases } from "./cases/conversation-quality/persona";
import { fixture, runEvaluation } from "./fixtures";
import { record } from "./report";

/** 已进入 Planner 的质量测评；不把 trigger 的过滤当成模型选择沉默。 */
for (const scenario of [
  ...participationCases,
  ...expressionCases,
  ...personaCases,
  ...continuityCases,
]) {
  test(scenario.title, async () => {
    await runEvaluation(scenario, scenario, async () => {
      fixture.qualityToolResults = scenario.toolResults;
      const timezone = (await load_config()).app!.timezone!;
      const scope = { characterId: "yuuno", platform: "onebot" as const, channelId: "20001" };
      const history: ConversationMessage[] = scenario.history.map((message, index) => ({
        ...message,
        sequence: index + 1,
      }));
      const planner = new Planner(scope);
      const replyer = new Replyer(scope);
      const connection = new OneBotConnection("yuuno", "悠乃", {
        self_id: "90001",
        endpoint: "ws://eval.invalid",
      });
      let sentCount = 0;
      vi.spyOn(connection, "sendText").mockImplementation(async (_channelId, content, target) => {
        const event: IncomingEvent = {
          ...participants.self,
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
          ...participants.self,
          kind: "poke",
          timestamp: Date.now(),
          targetSenderId,
        };
        record("effect", "QQ 戳一戳（模拟确认）", event);
        return event;
      });
      await planner.initialize({ history: [], summary: { text: "", coveredThrough: 0 } });
      await replyer.initialize({ text: "", coveredThrough: 0 });
      record("effect", "群聊背景", { messages: history });
      if (history.length) {
        planner.appendBackground(
          `以下是本轮开始前已经发生的群聊，仅作为背景，不补答旧消息：\n${history.map((message) => renderMessage(message, timezone)).join("\n")}`,
        );
      }
      const receivedEvents: ConversationAgentEvent[] = [];
      let pending: ConversationMessage[] = [];
      let pendingEvents: ConversationAgentEvent[] = [];
      let waiting: { startedAt: number; until: number } | undefined;
      let inputIndex = 0;
      let round = 0;
      const startedAt = new Date(scenario.time).getTime();
      const endAt = startedAt + scenario.observeUntilSeconds * 1000;
      try {
        while (inputIndex < scenario.inputs.length || waiting) {
          const input = scenario.inputs[inputIndex];
          const nextInputAt = input ? startedAt + input.atSeconds * 1000 : Infinity;
          const now = Math.min(nextInputAt, waiting?.until ?? Infinity);
          if (now > endAt) {
            record("effect", "观察结束时仍在等待", { until: waiting?.until, endAt });
            break;
          }
          vi.setSystemTime(now);
          if (input && now === nextInputAt) {
            const messages = input.messages.map((message, index) => ({
              ...message,
              sequence: history.length + index + 1,
            }));
            pending.push(...messages);
            history.push(...messages);
            pendingEvents.push(...input.agentEvents);
            receivedEvents.push(...input.agentEvents);
            record("effect", "群聊新输入", {
              messages: input.messages,
              agentEvents: input.agentEvents,
            });
            inputIndex++;
          }
          const directed = pending.some((message) =>
            isDirectedMessage(message, "90001", ["悠乃", "悠酱"]),
          );
          if (waiting && now < waiting.until && !directed && !pendingEvents.length) {
            continue;
          }
          const waitedSeconds = waiting ? (now - waiting.startedAt) / 1000 : undefined;
          waiting = undefined;
          planner.appendInput(pending, waitedSeconds);
          for (const event of pendingEvents) {
            planner.appendBackground(
              [
                `来自主 loop 的${event.type === "share" ? "分享意图" : "交流反馈"}（事件 ID：${event.id}）`,
                `发生时间：${formatLlmDateTime(event.occurredAt, timezone)}`,
                ...(event.type === "result" ? [`关联事件 ID：${event.relatedEventId}`] : []),
                event.content,
              ].join("\n"),
            );
          }
          pending = [];
          pendingEvents = [];
          record("effect", "Planner 观察轮次", {
            round: ++round,
            time: formatLlmDateTime(now, timezone),
            waitedSeconds,
          });
          const execution: ConversationToolContext = {
            canParticipate: () => true,
            readCharacter: async () => scenario.characterState,
            notifyCharacter: async (description, messageIds, relatedEventId) => {
              if (relatedEventId && !receivedEvents.some((event) => event.id === relatedEventId)) {
                return "未投递：关联事件不在本群已接收的主 loop 输入中。";
              }
              const id = randomUUID();
              record("effect", "向主 loop 提交交流（内存）", {
                id,
                description,
                messageIds,
                relatedEventId,
              });
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
          record("effect", "Planner 本轮结束", {
            round,
            sent: execution.sendAttempted,
            failed: execution.failed,
            waitSeconds: execution.waitSeconds,
          });
          if (execution.failed) {
            throw new Error("本轮工具执行失败，查看工具轨迹；不能判作正常沉默");
          }
          if (execution.waitSeconds !== undefined) {
            waiting = { startedAt: now, until: now + execution.waitSeconds * 1000 };
          }
        }
      } finally {
        await planner.stop();
        await replyer.stop();
      }
    });
  });
}
