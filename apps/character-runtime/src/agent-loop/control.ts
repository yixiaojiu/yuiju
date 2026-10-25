import { randomUUID } from "node:crypto";
import type {
  ExtensionContext,
  ExtensionSceneResult,
  SceneAgentDefinition,
  SceneExecution,
  SceneInstance,
} from "@yuiju/shared/extension/agent";
import type { SceneStatus } from "@yuiju/shared/extension/scene-requests";
import { logger } from "@yuiju/shared/logger/logger";
import type { ActivityView, CurrentWorldView } from "@yuiju/shared/world/protocol";
import { type ExtensionRuntime, waitForExecution } from "../extensions/runtime";
import type { WorldClient } from "../world/client";

type SceneSession = {
  id: string;
  agentId: string;
  definition: SceneAgentDefinition;
  context: ExtensionContext;
  entryContext?: string;
  source: "main" | "user";
  ready: boolean;
  /** 发出暂停请求即记录；响应丢失时仍需要向世界确认恢复。 */
  pauseAttempted: boolean;
  cancellation: AbortController;
  instance?: SceneInstance;
  closing?: Promise<void>;
};

type ControlState =
  | { type: "main"; requested?: SceneSession }
  | { type: "waiting_entry" | "scene" | "exiting"; session: SceneSession };

/** 只管理一个角色的控制权；进入意图在完整主 agent 步骤结束后才转为等待。 */
export class AgentControl {
  private state: ControlState = { type: "main" };
  private lifecycleTask: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly extensions: ExtensionRuntime,
    private readonly entryTimeoutMs: number,
    private readonly world: WorldClient,
    private readonly observeActivity: (activity: ActivityView) => Promise<void>,
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

  /** 模型只能走带条件检查的入口，不能指定用户来源。 */
  async requestEntry(agentId: string, context?: string) {
    const loaded = this.extensions.loaded.agents.get(agentId);
    if (!loaded || loaded.definition.type !== "scene") {
      throw new Error(`未启用的场景 agent：${agentId}`);
    }
    const current = await this.inspectAwakeWorld();
    const reason = loaded.definition.checkEntry?.(current);
    if (reason) {
      throw new Error(reason);
    }
    return this.registerEntry(agentId, "main", context);
  }

  /** 用户可以跳过扩展的地点条件，但不能打断睡眠；仍等待当前主步骤结束。 */
  async requestUserEntry(agentId: string, context?: string): Promise<SceneStatus> {
    await this.inspectAwakeWorld();
    const result = this.registerEntry(agentId, "user", context);
    this.wake();
    return result;
  }

  private registerEntry(agentId: string, source: "main" | "user", context?: string): SceneStatus {
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
      source,
      ready: false,
      pauseAttempted: false,
      cancellation: new AbortController(),
    };
    this.state.requested = session;
    return this.readStatus(agentId, session.id);
  }

  readStatus(agentId: string, sessionId: string): SceneStatus {
    const session = this.state.type === "main" ? this.state.requested : this.state.session;
    if (!session || session.id !== sessionId || session.agentId !== agentId) {
      throw new Error("场景会话不存在或已结束");
    }
    return {
      sessionId,
      agentId,
      phase: this.state.type === "main" ? "requested" : this.state.type,
      ready: this.state.type === "waiting_entry" && session.ready,
    };
  }

  /** 睡眠属于角色宿主的统一限制，不由扩展或请求来源决定。 */
  private async inspectAwakeWorld(): Promise<CurrentWorldView> {
    const result = await this.world.inspect({ type: "current" });
    if (!result.ok) {
      throw new Error(result.message);
    }
    if (result.value.type !== "current") {
      throw new Error("世界 current 查询返回了其他类型");
    }
    const activity = result.value.activity;
    if (activity?.actionId === "睡觉" || activity?.actionId === "再睡一会") {
      throw new Error("角色正在睡觉，醒来后才能进入场景。");
    }
    return result.value;
  }

  /** 主轮次已保存完整工具结果后调用；等待用户的 Promise 不占用事件调度。 */
  beginEntry(): void {
    if (this.state.type !== "main" || !this.state.requested) {
      return;
    }
    const session = this.state.requested;
    this.state = { type: "waiting_entry", session };
    this.lifecycleTask = this.runSession(session);
  }

  private async runSession(session: SceneSession): Promise<void> {
    const { signal } = session.cancellation;
    const timer = setTimeout(
      () => session.cancellation.abort(new Error("等待用户进入场景超时")),
      this.entryTimeoutMs,
    );
    let entered = false;
    try {
      session.instance = session.definition.create(session.context);
      signal.throwIfAborted();
      const result = await waitForExecution(
        session.instance.waitForEntry(session.entryContext, this.execution(session, signal)),
        signal,
      );
      signal.throwIfAborted();
      if (result.status === "rejected") {
        await this.finish(session, { status: "failed", reason: result.reason });
        return;
      }
      // 等待用户期间世界仍在运行；正式交接重新查询，按活动 ID 原子暂停。
      const current = await this.inspectAwakeWorld();
      signal.throwIfAborted();
      if (session.source === "main") {
        const reason = session.definition.checkEntry?.(current);
        if (reason) {
          throw new Error(reason);
        }
      }
      if (!current.activity) {
        throw new Error("世界尚未提供当前活动，不能交接场景");
      }
      await this.changeConversationPause(session.definition.pauseConversation === true);
      signal.throwIfAborted();
      session.pauseAttempted = true;
      const activity = await this.world.controlActivity({
        type: "pause",
        sessionId: session.id,
        activityId: current.activity.activityId,
      });
      await this.observeActivity(activity);
      signal.throwIfAborted();
      this.state = { type: "scene", session };
      entered = true;
      clearTimeout(timer);
      // 扩展拥有完整 loop；这里一直等待到场景退出，不参与其事件与轮次调度。
      const outcome = await session.instance.run(this.execution(session, signal));
      await this.finish(session, { status: "ended", ...outcome });
    } catch (error) {
      if (entered && !this.stopped) {
        logger.error("扩展场景执行失败，结束场景", { agent: session.agentId, error });
      }
      await this.finish(session, {
        status: entered ? "ended" : "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      this.lifecycleTask = undefined;
    }
  }

  /** 主步骤失败时撤销尚未开始的准备，避免工具结果不完整却转移控制权。 */
  async rejectRequestedEntry(reason: string): Promise<void> {
    if (this.state.type === "main" && this.state.requested?.source === "main") {
      await this.finish(this.state.requested, { status: "failed", reason });
    }
  }

  /** 连接在进入阶段建立，回调始终绑定该会话，不能影响后来创建的场景。 */
  private execution(session: SceneSession, signal: AbortSignal): SceneExecution {
    return {
      sessionId: session.id,
      signal,
      ready: () => {
        if (this.state.type === "waiting_entry" && this.state.session === session) {
          session.ready = true;
        }
      },
    };
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
    if (session.pauseAttempted) {
      try {
        const activity = await this.world.controlActivity({
          type: "resume",
          sessionId: session.id,
        });
        await this.observeActivity(activity);
      } catch (error) {
        // 保持 exiting，不能在世界仍暂停时恢复 main。重启时由角色恢复遗留暂停。
        logger.error("场景退出后活动恢复失败，停止交接，不再重试", { error });
        return;
      }
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
      // 先等扩展停止在途操作，再释放资源和恢复世界活动。
      await this.lifecycleTask;
      await this.finish(session, {
        status: this.state.type === "waiting_entry" ? "failed" : "ended",
        reason: "角色停止",
      });
    }
  }
}
