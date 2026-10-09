import { test, vi } from "vitest";
import { MainAgentLoop } from "../src/agent-loop/main";
import type { AgentToolContext } from "../src/agent-loop/tools";
import { Emotion } from "../src/emotion/emotion";
import { WorldClient } from "../src/world/client";
import { mainAgentCases } from "./cases/main-agent";
import { fixture, runEvaluation } from "./fixtures";
import { record } from "./report";
import { createEvaluationWorld } from "./world";

for (const scenario of mainAgentCases) {
  test(scenario.title, async () => {
    await runEvaluation(
      scenario,
      {
        ...scenario,
        plans: [],
        memories: "无相关记录",
        emotion: { pleasure: 50, activation: 50, control: 50 },
      },
      async (signal) => {
        fixture.events = [scenario.event];
        const simulation = createEvaluationWorld(
          scenario.world,
          Date.parse(scenario.time),
          scenario.timezone,
        );
        const world = new WorldClient(
          "yuuno",
          async () => {},
          async () => {},
          { queueAgentEvents: true },
        );
        const emotion = new Emotion("yuuno");
        vi.spyOn(world, "inspect").mockImplementation(async (query) => {
          record("effect", "世界查询（真实规则，内存状态）", query);
          if (scenario.unavailable) {
            return {
              ok: false,
              code: "world_unavailable",
              message: "世界服务暂时不可用，当前活动状态未确认。",
            };
          }
          return simulation.inspect(query);
        });
        vi.spyOn(world, "execute").mockImplementation(async (input) => {
          record("effect", "提交世界行动（真实规则，内存状态）", input);
          if (scenario.unavailable) {
            return {
              ok: false,
              code: "world_unavailable",
              message: "世界服务暂时不可用，当前活动状态未确认。",
            };
          }
          const result = simulation.execute(input);
          if (result.ok) {
            record("effect", "行动后的角色状态（内存）", simulation.state.characters.yuuno);
          }
          return result;
        });
        vi.spyOn(emotion, "read").mockImplementation(async () => ({
          pleasure: 50,
          activation: 50,
          control: 50,
          updatedAt: Date.now(),
          feelings: [],
        }));
        vi.spyOn(emotion, "submit").mockImplementation(async (id, content, occurredAt) => {
          record("effect", "提交感受（内存，不运行情绪 sub agent）", { id, content, occurredAt });
        });
        const execution: AgentToolContext = {
          characterId: "yuuno",
          world,
          emotion,
          share: async (requestId, intention) => {
            record("effect", "广播分享意图（内存，未发送群消息）", { requestId, intention });
            return `分享意图已交给各个 QQ 群，事件 ID：${requestId}。是否发送由各群决定。`;
          },
          respondConversation: async (requestId, eventId, content) => {
            if (scenario.event.type !== "conversation" || scenario.event.id !== eventId) {
              return "未投递：请使用收到的群聊事件 ID。";
            }
            record("effect", "向来源群反馈（内存，未发送群消息）", {
              requestId,
              eventId,
              content,
              scope: scenario.event.scope,
            });
            return `已投递给来源群 Planner，事件 ID：${requestId}。尚未发送群消息。`;
          },
          observeActivity: async (activity) => {
            record("effect", "同步角色当前活动（内存）", activity);
          },
          syncWorldActivity: async () => {
            const result = await world.inspect({ type: "current" });
            if (!result.ok) {
              return result.message;
            }
            if (result.value.type === "current") {
              await execution.observeActivity(result.value.activity);
            }
            return null;
          },
        };
        const loop = new MainAgentLoop(execution);
        await loop.initialize();
        let complete!: (result: { error?: unknown }) => void;
        const completed = new Promise<{ error?: unknown }>((resolve) => {
          complete = resolve;
        });
        fixture.complete = (error) => complete({ error });
        const abort = () => complete({ error: signal.reason });
        signal.addEventListener("abort", abort, { once: true });
        try {
          signal.throwIfAborted();
          loop.start();
          const result = await completed;
          if (result.error) {
            throw result.error;
          }
        } finally {
          signal.removeEventListener("abort", abort);
          await loop.stop();
          record("effect", "本轮结束时的运行状态（内存）", {
            character: simulation.state.characters.yuuno,
            remainingEvents: fixture.events,
            round: fixture.agentState?.round,
          });
        }
      },
    );
  });
}
