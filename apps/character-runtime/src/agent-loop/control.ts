import { randomUUID } from "node:crypto";
import type {
  ExtensionContext,
  ExtensionSceneResult,
  SceneAgentDefinition,
  SceneEvent,
  SceneInstance,
} from "@yuiju/shared/extension/agent";
import { logger } from "@yuiju/shared/logger/logger";
import { type ExtensionRuntime, waitForExecution } from "../extensions/runtime";

type SceneSession = {
  id: string;
  agentId: string;
  definition: SceneAgentDefinition<unknown>;
  context: ExtensionContext<unknown>;
  entryContext?: string;
  cancellation: AbortController;
  instance?: SceneInstance;
  events: SceneEvent[];
  closing?: Promise<void>;
};

type ControlState =
  | { type: "main"; requested?: SceneSession }
  | { type: "waiting_entry" | "scene" | "exiting"; session: SceneSession };

/** 只管理一个角色的控制权；进入意图在完整主 agent 步骤结束后才转为等待。 */
export class AgentControl {
  private state: ControlState = { type: "main" };
  private entryTask: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly extensions: ExtensionRuntime,
    private readonly entryTimeoutMs: number,
    private readonly changeConversationPause: (paused: boolean) => Promise<void>,
    private readonly publishResult: (result: ExtensionSceneResult) => Promise<void>,
    private readonly wake: () => void,
  ) {}

  get phase() {
    return this.state.type;
  }

  get entryRequested(): boolean {
    return this.state.type === "main" && this.state.requested !== undefined;
  }

  /** 请求只登记意图；同一步仍在执行的其他工具可以正常完成。 */
  requestEntry(agentId: string, context?: string) {
    if (this.stopped || this.state.type !== "main" || this.state.requested) {
      throw new Error("当前已有场景准备或执行中，不能重复申请进入");
    }
    const loaded = this.extensions.loaded.agents.get(agentId);
    if (!loaded || loaded.definition.type !== "scene") {
      throw new Error(`未启用的场景 agent：${agentId}`);
    }
    const session: SceneSession = {
      id: randomUUID(),
      agentId,
      definition: loaded.definition,
      context: loaded.context,
      entryContext: context,
      cancellation: new AbortController(),
      events: [],
    };
    this.state.requested = session;
    return {
      status: "waiting_entry",
      sessionId: session.id,
      message: "已登记准备请求，完成当前步骤后等待扩展确认用户进入。",
    };
  }

  /** 主轮次已保存完整工具结果后调用；等待用户的 Promise 不占用事件调度。 */
  beginEntry(): void {
    if (this.state.type !== "main" || !this.state.requested) {
      return;
    }
    const session = this.state.requested;
    this.state = { type: "waiting_entry", session };
    this.entryTask = this.waitForEntry(session);
  }

  private async waitForEntry(session: SceneSession): Promise<void> {
    const { signal } = session.cancellation;
    const timer = setTimeout(
      () => session.cancellation.abort(new Error("等待用户进入场景超时")),
      this.entryTimeoutMs,
    );
    try {
      session.instance = session.definition.create(session.context);
      await this.changeConversationPause(session.definition.pauseConversation === true);
      signal.throwIfAborted();
      const result = await waitForExecution(
        session.instance.waitForEntry(session.entryContext, { sessionId: session.id, signal }),
        signal,
      );
      signal.throwIfAborted();
      if (result.status === "rejected") {
        await this.finish(session, { status: "failed", reason: result.reason });
        return;
      }
      this.state = { type: "scene", session };
      session.events.push({
        id: randomUUID(),
        occurredAt: Date.now(),
        type: "scene_entered",
        payload: { context: session.entryContext },
      });
      this.wake();
    } catch (error) {
      await this.finish(session, {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      this.entryTask = undefined;
    }
  }

  /** 主步骤失败时撤销尚未开始的准备，避免工具结果不完整却转移控制权。 */
  async rejectRequestedEntry(reason: string): Promise<void> {
    if (this.state.type === "main" && this.state.requested) {
      await this.finish(this.state.requested, { status: "failed", reason });
    }
  }

  /** 本期只提供程序入口；页面或其他进程如何调用由后续接入层负责。 */
  receiveEvent(sessionId: string, input: unknown): void {
    if (this.state.type !== "scene" || this.state.session.id !== sessionId) {
      throw new Error("场景会话不存在或已结束");
    }
    const session = this.state.session;
    if (!session.definition.eventSchema) {
      throw new Error("该场景没有声明自定义事件");
    }
    const payload = session.definition.eventSchema.parse(input);
    session.events.push({ id: randomUUID(), occurredAt: Date.now(), type: "extension", payload });
    this.wake();
  }

  /** 只收窄模型输入；世界连接与活动同步不受此列表影响。 */
  acceptsWorldEvent(type: Extract<SceneEvent, { type: "world" }>["payload"]["type"]): boolean {
    return (
      this.state.type === "scene" &&
      this.state.session.definition.worldEvents?.includes(type) === true
    );
  }

  async runScene(events: SceneEvent[]): Promise<boolean> {
    if (this.state.type !== "scene") {
      throw new Error("当前没有掌握控制权的场景");
    }
    const session = this.state.session;
    const batch = [...session.events.splice(0), ...events];
    if (!batch.length) {
      return false;
    }
    const signal = session.cancellation.signal;
    try {
      signal.throwIfAborted();
      const result = await waitForExecution(
        session.instance!.handleEvents(batch, { sessionId: session.id, signal }),
        signal,
      );
      signal.throwIfAborted();
      if (result.status === "exit") {
        await this.finish(session, {
          status: "ended",
          reason: result.reason,
          context: result.context,
        });
      }
    } catch (error) {
      logger.error("扩展场景执行失败，结束场景", { agent: session.agentId, error });
      await this.finish(session, {
        status: "ended",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  /** 多个结束来源共享一次清理；不会释放两次实例或重复投递结束事件。 */
  private async finish(
    session: SceneSession,
    result: Pick<ExtensionSceneResult, "status" | "reason" | "context">,
  ): Promise<void> {
    session.closing ??= this.close(session, result);
    await session.closing;
  }

  private async close(
    session: SceneSession,
    result: Pick<ExtensionSceneResult, "status" | "reason" | "context">,
  ): Promise<void> {
    this.state = { type: "exiting", session };
    session.cancellation.abort(new Error(result.reason));
    try {
      await session.instance?.dispose();
    } catch (error) {
      logger.error("扩展场景资源释放失败", { agent: session.agentId, error });
    }
    try {
      if (!this.stopped) {
        try {
          await this.changeConversationPause(false);
        } catch (error) {
          logger.error("场景退出后的聊天恢复失败", { error });
        }
        await this.publishResult({ agentId: session.agentId, sessionId: session.id, ...result });
      }
    } catch (error) {
      logger.error("扩展场景结束结果提交失败，不再重试", { agent: session.agentId, error });
    } finally {
      this.state = { type: "main" };
      if (!this.stopped) {
        this.wake();
      }
    }
  }

  /** 先取消等待与当前场景轮次；退出结果不在停机期间再次唤醒 main。 */
  async stop(): Promise<void> {
    this.stopped = true;
    const session = this.state.type === "main" ? this.state.requested : this.state.session;
    if (session) {
      session.cancellation.abort(new Error("角色停止"));
      await this.finish(session, {
        status: this.state.type === "waiting_entry" ? "failed" : "ended",
        reason: "角色停止",
      });
    }
    await this.entryTask;
  }
}
