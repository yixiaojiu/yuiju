import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load_config } from "@yuiju/shared/config/load";
import { initializePrompts } from "@yuiju/shared/prompt/template";
import type {
  CalendarItem,
  CalendarQuery,
  CalendarQueryResult,
  CalendarWrite,
} from "@yuiju/shared/world/calendar";
import type { WorldResult } from "@yuiju/shared/world/protocol";
import type { ToolSet } from "ai";
import { beforeAll, inject, vi } from "vitest";
import {
  createCalendarItem,
  selectCalendarItems,
  updateCalendarItem,
} from "../../world-simulator/src/calendar/calendar";
import type { CharacterEvent } from "../src/agent-loop/events";
import type { AgentAction, AgentState } from "../src/agent-loop/storage";
import type { ConversationQualityCase } from "./cases/conversation-quality";
import { type EvaluationCase, type EvaluationResult, record, snapshot, traceScope } from "./report";

declare module "vitest" {
  interface ProvidedContext {
    evalOutputDir: string;
  }
}

beforeAll(async () => {
  await initializePrompts();
});

/** 每个用例重建；仅替代外部状态，不模拟 Planner 或主 loop 的判断。 */
export const fixture = {
  qualityToolResults: null as ConversationQualityCase["toolResults"] | null,
  events: [] as CharacterEvent[],
  agentState: null as AgentState | null,
  actions: [] as AgentAction[],
  calendar: [] as CalendarItem[],
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
    if (
      message === "主 agent 本轮执行失败，结束本批，不再重试" ||
      message === "主 agent 状态读写失败，停止本次调度"
    ) {
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
                      let output: unknown;
                      const materials = fixture.qualityToolResults;
                      if (materials && name === "understandMedia") {
                        const media = (input as { media: { url: string }[] }).media;
                        output = media
                          .map(({ url }) => {
                            if (!(url in materials.media)) {
                              throw new Error(`用例未定义媒体材料：${url}`);
                            }
                            return materials.media[url];
                          })
                          .join("\n");
                      } else if (materials && name === "recall") {
                        output = materials.recall;
                      } else if (materials && name === "readPerson") {
                        const id = (input as { "sender-id": string })["sender-id"];
                        output =
                          id in materials.people
                            ? materials.people[id]
                            : "没有当前可用的人物认识；这不代表第一次相识。";
                      } else {
                        output = await execute(input, context);
                      }
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
export function queryEvaluationCalendar(
  characterId: string,
  query: CalendarQuery,
): WorldResult<CalendarQueryResult> {
  const result = selectCalendarItems(
    fixture.calendar,
    characterId,
    query,
    "Asia/Shanghai",
    Date.now(),
  );
  return result === null
    ? { ok: false, code: "calendar_item_not_found", message: "事项不存在" }
    : { ok: true, value: result };
}
vi.mock("../src/world/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/world/client")>()),
  queryWorldCalendar: async (characterId: string, query: CalendarQuery) =>
    queryEvaluationCalendar(characterId, query),
}));

export function writeEvaluationCalendar(
  characterId: string,
  input: CalendarWrite,
  requestId: string,
) {
  let item: CalendarItem;
  try {
    if (input.operation === "create") {
      const { operation: _operation, ...fields } = input;
      item = createCalendarItem(characterId, requestId, fields, Date.now(), "Asia/Shanghai");
    } else {
      const previous = fixture.calendar.find(
        (entry) => entry.id === input.itemId && entry.characterId === characterId,
      );
      if (!previous) {
        return {
          ok: false as const,
          code: "calendar_item_not_found" as const,
          message: "事项不存在",
        };
      }
      if (previous.revision !== input.expectedRevision) {
        return { ok: false as const, code: "request_conflict" as const, message: "版本不一致" };
      }
      item = updateCalendarItem(previous, input, Date.now(), "Asia/Shanghai");
    }
    fixture.calendar = [...fixture.calendar.filter((entry) => entry.id !== item.id), item];
    record("effect", "写入日历（真实规则，内存）", item);
    return {
      ok: true as const,
      value: {
        id: item.id,
        revision: item.revision,
        createdAt: item.createdAt,
        deleteAt: item.deleteAt,
        expiresAt: item.kind === "task" ? item.expiresAt : null,
        repeatUntilAt: item.kind === "event" ? item.repeatUntilAt : null,
      },
    };
  } catch (error) {
    return {
      ok: false as const,
      code: "invalid_request" as const,
      message: (error as Error).message,
    };
  }
}
vi.mock("../src/agent-loop/events", async (importOriginal) => ({
  recordWorldExperiences: (await importOriginal<typeof import("../src/agent-loop/events")>())
    .recordWorldExperiences,
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
  timeoutMs = 90_000,
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
    () => controller.abort(new Error(`测评超过 ${timeoutMs / 1000} 秒，已中止模型请求`)),
    timeoutMs,
  );
  fixture.qualityToolResults = null;
  fixture.events = [];
  fixture.actions = [];
  fixture.calendar = [];
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
      result.configuration = snapshot({
        environment: "development",
        caseHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
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
                request: provider.request,
              })),
            },
          ]),
        ),
      });
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
