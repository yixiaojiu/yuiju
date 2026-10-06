import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load_config } from "@yuiju/shared/config/load";
import type { ToolSet } from "ai";
import { inject, vi } from "vitest";
import type { CharacterEvent } from "../src/agent-loop/events";
import type { AgentAction, AgentState } from "../src/agent-loop/storage";
import type { Plan } from "../src/plan/plan";
import { type EvaluationCase, type EvaluationResult, record, snapshot, traceScope } from "./report";

declare module "vitest" {
  interface ProvidedContext {
    evalOutputDir: string;
  }
}

/** 每个用例重建；仅替代外部状态，不模拟 Planner 或主 loop 的判断。 */
export const fixture = {
  events: [] as CharacterEvent[],
  agentState: null as AgentState | null,
  actions: [] as AgentAction[],
  plans: [] as Plan[],
  complete: (_error?: unknown) => {},
};

vi.mock("@yuiju/shared/logger/logger", () => {
  function log(level: string, message: string, data: Record<string, unknown> = {}) {
    const scope = traceScope.getStore();
    if (!scope) {
      return;
    }
    if (message === "e2e.llm.request") {
      record("request", "模型 HTTP 请求", data);
    } else if (message === "e2e.llm.response") {
      // 响应正文已由 SDK 步骤记录，避免保存两份相同的大段文字。
      record("log", "模型 HTTP 响应", { ...data, body: undefined });
    } else {
      record("log", message, { level, ...data });
    }
    if (message === "角色主 loop 中断，保留当前进度等待接续") {
      fixture.complete(data.error);
    }
  }
  return {
    logger: {
      isLevelEnabled: () => true,
      silly: (message: string, data?: Record<string, unknown>) => log("silly", message, data),
      info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
      warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
      error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
    },
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    /** 只加观测与测评中止信号，SDK 仍负责模型请求、工具分派和循环停止条件。 */
    generateText: async (options: Parameters<typeof actual.generateText>[0]) => {
      const scope = traceScope.getStore()!;
      const name = typeof options.model === "string" ? options.model : options.model.modelId;
      const callId = record("log", `开始 ${name} 模型调用`, {});
      const tools: ToolSet = {};
      for (const [name, definition] of Object.entries(options.tools ?? {})) {
        const execute = definition.execute;
        tools[name] = execute
          ? {
              ...definition,
              execute: async (input, context) => {
                const toolId = record("tool", name, input);
                return await traceScope.run(
                  { ...traceScope.getStore()!, parent: toolId },
                  async () => {
                    try {
                      const output = await execute(input, context);
                      // 测评中止后不再把工具结果送入下一次模型请求。
                      scope.signal.throwIfAborted();
                      record("effect", `${name} 返回`, output);
                      return output;
                    } catch (error) {
                      record("effect", `${name} 抛错`, error);
                      throw error;
                    }
                  },
                );
              },
            }
          : definition;
      }
      return await traceScope.run(
        { ...scope, parent: callId },
        async () =>
          await actual.generateText({
            ...options,
            tools,
            abortSignal: options.abortSignal
              ? AbortSignal.any([scope.signal, options.abortSignal])
              : scope.signal,
            onStepEnd: async (step) => {
              record("step", `${name} 步骤完成`, {
                finishReason: step.finishReason,
                content: step.content,
                usage: step.usage,
              });
              if (options.onStepEnd) {
                const callbacks = Array.isArray(options.onStepEnd)
                  ? options.onStepEnd
                  : [options.onStepEnd];
                for (const callback of callbacks) {
                  await callback(step);
                }
              }
            },
          }),
      );
    },
  };
});

vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: async (milliseconds: number) => {
    record("log", "跳过分段发送延迟", { milliseconds });
  },
}));

vi.mock("@yuiju/shared/database/redis", () => ({
  getRedis: async () => {
    throw new Error("测评禁止连接真实 Redis");
  },
}));
vi.mock("@yuiju/shared/database/mongo", () => ({
  getMongoDatabase: async () => {
    throw new Error("测评禁止连接真实 MongoDB");
  },
}));
vi.mock("../src/memory/recall", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/memory/recall")>()),
  recallExperiences: async () => "本场景没有可回忆的相关经历；不表示此前从未经历过。",
}));

vi.mock("../src/memory/experiences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/memory/experiences")>()),

  recordExperience: async (_characterId: string, material: unknown) => {
    record("effect", "记录经历（内存）", material);
  },
}));
vi.mock("../src/memory/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/memory/people")>()),
  readPeople: async () => [],
}));
vi.mock("../src/memory/self-cognition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/memory/self-cognition")>()),
  readSelfCognition: async () => ({
    text: "我一直生活在这里，上学、打工和与群友聊天都是日常的一部分。",
    updatedAt: null,
    lastBatchId: null,
  }),
}));
vi.mock("../src/plan/plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plan/plan")>()),
  readPlans: async () => structuredClone(fixture.plans),
  signalPlansDue: async () => {},
  nextPlanAttention: async () => null,
  savePlan: async (
    _characterId: string,
    id: string,
    input: Omit<Plan, "id" | "revision" | "updatedAt" | "operationId">,
    operationId: string,
    create: boolean,
  ) => {
    const previous = fixture.plans.find((plan) => plan.id === id);
    if (create ? previous !== undefined : previous === undefined) {
      throw new Error(`场景中计划 ${id} 的创建/更新条件不成立`);
    }
    const plan = {
      ...input,
      id,
      revision: (previous?.revision ?? 0) + 1,
      operationId,
      updatedAt: Date.now(),
    };
    fixture.plans = [...fixture.plans.filter((item) => item.id !== id), plan];
    record("effect", "保存计划（内存）", plan);
    return plan;
  },
}));
vi.mock("../src/agent-loop/events", () => ({
  signalActivityDue: async () => {},
  readActivityWait: async () => null,
  readCharacterEvents: async () => ({
    events: structuredClone(fixture.events),
    eventIds: fixture.events.map((event) => event.id),
    worldEventIds: [],
  }),
}));
vi.mock("../src/agent-loop/storage", () => ({
  loadAgentState: async () => structuredClone(fixture.agentState),
  saveAgentState: async (_characterId: string, state: AgentState) => {
    fixture.agentState = structuredClone(state);
  },
  readAgentActions: async () => structuredClone(fixture.actions),
  appendAgentAction: async (_characterId: string, _roundId: string, action: AgentAction) =>
    fixture.actions.push(structuredClone(action)) - 1,
  saveAgentAction: async (
    _characterId: string,
    _roundId: string,
    index: number,
    action: AgentAction,
  ) => {
    fixture.actions[index] = structuredClone(action);
  },
  finishAgentRound: async (_characterId: string, state: AgentState) => {
    fixture.agentState = structuredClone({ ...state, round: null });
    fixture.events = fixture.events.filter((event) => !state.round!.eventIds.includes(event.id));
    record("effect", "主 loop 完成本轮，消费输入事件（内存）", { remainingEvents: fixture.events });
    fixture.complete();
  },
}));

/** 用例异常也写报告；只在报告落盘后让 Vitest 判失败。 */
export async function runEvaluation(
  scenario: EvaluationCase,
  input: unknown,
  execute: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const result: EvaluationResult = {
    ...scenario,
    input: snapshot(input),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    trace: [],
  };
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("测评超过 90 秒，已中止模型请求")),
    90_000,
  );
  fixture.events = [];
  fixture.actions = [];
  fixture.plans = [];
  fixture.agentState = null;
  fixture.complete = () => {};
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(scenario.time));
  const fetch = globalThis.fetch;
  let requestCount = 0;
  vi.stubGlobal(
    "fetch",
    async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      // 唯一媒体测试地址；其他请求仍走项目配置中的真实模型供应商。
      if (String(url) === "https://eval.invalid/missing-image.png") {
        return new Response("not found", { status: 404 });
      }
      if (++requestCount > 20) {
        controller.abort(new Error("测评超过 20 次模型 HTTP 请求上限"));
      }
      controller.signal.throwIfAborted();
      return await fetch(url, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      });
    },
  );
  try {
    await traceScope.run({ result, startedAt, signal: controller.signal }, async () => {
      const config = await load_config();
      result.configuration = {
        environment: "development",
        timezone: config.app?.timezone,
        models: Object.fromEntries(
          (["flash", "chat", "strong"] as const).map((name) => [
            name,
            {
              contextWindowTokens: config.llm?.models?.[name]?.context_window_tokens,
              providers: config.llm?.models?.[name]?.providers.map((provider) => ({
                destination: new URL(provider.base_url).origin,
                model: provider.model,
                supportsStructuredOutputs: provider.supports_structured_outputs,
              })),
            },
          ]),
        ),
      };
      await execute(controller.signal);
      controller.signal.throwIfAborted();
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    result.durationMs = Math.round(performance.now() - startedAt);
    await writeFile(
      join(inject("evalOutputDir"), `${scenario.id}.case.json`),
      JSON.stringify(result, null, 2),
    );
  }
  if (result.error) {
    throw new Error(result.error);
  }
}
