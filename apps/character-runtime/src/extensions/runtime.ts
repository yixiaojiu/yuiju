import { randomUUID } from "node:crypto";
import type { ExtensionTaskResult, TaskInstance } from "@yuiju/shared/extension/agent";
import { logger } from "@yuiju/shared/logger/logger";
import type { JsonValue } from "@yuiju/shared/world/protocol";
import { z } from "zod";
import type { LoadedExtensions } from "./load";

/** 与取消竞争等待执行结果；迟到的 resolve/reject 仍被接住，不再交付给调用方。 */
export async function waitForExecution<T>(execution: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([execution, cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** 角色独立的扩展任务实例与在途执行；场景生命周期由 AgentControl 管理。 */
export class ExtensionRuntime {
  private readonly stopping = new AbortController();
  private readonly instances = new Map<string, TaskInstance<unknown>>();
  private readonly tasks = new Map<string, Promise<ExtensionTaskResult>>();

  constructor(
    readonly loaded: LoadedExtensions,
    private readonly publishResult: (result: ExtensionTaskResult) => Promise<void>,
  ) {}

  initialize(): void {
    for (const [id, { definition, context }] of this.loaded.agents) {
      if (definition.type === "task") {
        this.instances.set(id, definition.create(context));
      }
    }
  }

  /** 目录只生成一次，作为主 agent 的稳定提示词部分。 */
  describeAgents(): string {
    return [...this.loaded.agents]
      .map(([id, { definition }]) => `- ${id}（${definition.type}）：${definition.description}`)
      .join("\n");
  }

  inspect(agentId: string) {
    const agent = this.loaded.agents.get(agentId);
    if (!agent) {
      throw new Error(`未启用的 agent：${agentId}`);
    }
    const definition = agent.definition;
    return {
      agentId,
      type: definition.type,
      description: definition.description,
      instructions: definition.instructions,
      ...(definition.type === "task"
        ? {
            inputSchema: z.toJSONSchema(definition.inputSchema, { io: "input" }),
            resultDescription: definition.resultDescription,
          }
        : {
            resultDescription:
              "主 agent 准备环境后等待用户主动进入，由扩展确认；结束时返回原因及可选上下文。",
          }),
    };
  }

  async call(
    agentId: string,
    mode: "sync" | "async",
    payload: string,
    callerSignal: AbortSignal,
  ): Promise<ExtensionTaskResult | { status: "accepted"; taskId: string; agentId: string }> {
    this.stopping.signal.throwIfAborted();
    callerSignal.throwIfAborted();
    const agent = this.loaded.agents.get(agentId);
    if (!agent || agent.definition.type !== "task") {
      throw new Error(`未启用的任务 agent：${agentId}`);
    }
    const input = agent.definition.inputSchema.parse(JSON.parse(payload));
    const taskId = randomUUID();
    const signal =
      mode === "sync"
        ? AbortSignal.any([callerSignal, this.stopping.signal])
        : this.stopping.signal;
    const execution = this.instances.get(agentId)!.run(input, { taskId, signal });
    const task = this.execute(agentId, taskId, execution, signal, mode);
    this.tasks.set(taskId, task);
    if (mode === "async") {
      return { status: "accepted", taskId, agentId };
    }
    return await task;
  }

  private async execute(
    agentId: string,
    taskId: string,
    execution: Promise<JsonValue>,
    signal: AbortSignal,
    mode: "sync" | "async",
  ): Promise<ExtensionTaskResult> {
    try {
      let result: ExtensionTaskResult;
      try {
        const value = await waitForExecution(execution, signal);
        signal.throwIfAborted();
        result = { taskId, agentId, status: "completed", result: value };
      } catch (error) {
        result = {
          taskId,
          agentId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
        if (!signal.aborted) {
          logger.error("扩展任务执行失败", { agent: agentId, error });
        }
      }
      if (mode === "async" && !this.stopping.signal.aborted) {
        try {
          await this.publishResult(result);
        } catch (error) {
          logger.error("扩展任务结果投递失败，不再重试", { agent: agentId, error });
        }
      }
      return result;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  async stop(): Promise<void> {
    this.stopping.abort(new Error("角色停止，取消扩展任务"));
    await Promise.allSettled(this.tasks.values());
    this.tasks.clear();
    const results = await Promise.allSettled(
      [...this.instances.values()].map(async (instance) => {
        await instance.dispose?.();
      }),
    );
    this.instances.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "扩展任务实例释放失败",
      );
    }
  }
}
