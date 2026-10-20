import type { SceneEvent } from "@yuiju/shared/extension/agent";
import { logger } from "@yuiju/shared/logger/logger";
import { CharacterAttention } from "./attention";
import { consumeCharacterEvents, readCharacterEvents, recordWorldExperiences } from "./events";
import { MainAgentLoop } from "./main";
import type { AgentToolContext } from "./tools";

/** 角色的事件调度器；main 和 scene 共用一条轮次执行链，关注计时独立运行。 */
export class AgentRuntime {
  private readonly main: MainAgentLoop;
  private readonly attention: CharacterAttention;
  private active = false;
  private requested = false;
  private task: Promise<void> | undefined;

  constructor(private readonly execution: AgentToolContext) {
    this.main = new MainAgentLoop(execution);
    this.attention = new CharacterAttention(execution.characterId, () => this.wake());
  }

  async initialize(): Promise<void> {
    await this.main.initialize();
  }

  start(): void {
    this.active = true;
    this.attention.start();
    this.wake();
  }

  scheduleAttention(): void {
    this.attention.schedule();
  }

  /** 新事件只请求下一批，不插入正在进行的模型步骤。 */
  wake(): void {
    this.requested = true;
    if (
      this.active &&
      !this.task &&
      (this.execution.control.phase === "main" || this.execution.control.phase === "scene")
    ) {
      this.task = this.run();
    }
  }

  private async run(): Promise<void> {
    const { characterId, control } = this.execution;
    try {
      while (this.active && this.requested) {
        this.requested = false;
        // 准备期间不消费 inbox；确认后交给 scene，失败则仍由 main 处理。
        if (control.phase === "waiting_entry" || control.phase === "exiting") {
          return;
        }
        const batch = await readCharacterEvents(characterId);
        if (!this.active) {
          return;
        }
        if (control.phase === "main") {
          if (!batch.events.length) {
            continue;
          }
          try {
            await this.main.run(batch);
            if (this.active) {
              control.beginEntry();
            }
          } catch (error) {
            await control.rejectRequestedEntry("主 agent 本步执行或保存失败，取消进入请求。");
            throw error;
          }
          this.requested = true;
          continue;
        }
        if (control.phase !== "scene") {
          continue;
        }

        const inputs: SceneEvent[] = [];
        const consumed = new Set<string>();
        for (const event of batch.events) {
          const { id, occurredAt } = event;
          if (event.type === "world") {
            consumed.add(id);
            if (control.acceptsWorldEvent(event.event.type)) {
              inputs.push({ id, occurredAt, type: "world", payload: event.event });
            }
          } else if (event.type === "activity_due") {
            consumed.add(id);
            inputs.push({
              id,
              occurredAt,
              type: event.type,
              payload: { activityId: event.activityId, endsAt: event.endsAt },
            });
          } else if (event.type === "plan_attention") {
            consumed.add(id);
            inputs.push({
              id,
              occurredAt,
              type: event.type,
              payload: {
                planId: event.planId,
                revision: event.revision,
                attentionAt: event.attentionAt,
              },
            });
          } else if (event.type === "plan_review") {
            consumed.add(id);
            inputs.push({
              id,
              occurredAt,
              type: event.type,
              payload: { planId: event.planId, revision: event.revision },
            });
          }
        }
        const selected = batch.events.filter((event) => consumed.has(event.id));
        if (selected.length) {
          await recordWorldExperiences(characterId, selected);
          // 场景不持久化执行进度；先消费固定批次，失败不重放。
          await consumeCharacterEvents(characterId, {
            events: selected,
            eventIds: batch.eventIds.filter((id) => consumed.has(id)),
            worldEventIds: batch.worldEventIds.filter((id) => consumed.has(id)),
          });
        }
        if (!this.active) {
          return;
        }
        const processed = await control.runScene(inputs);
        // 还有 main 专属输入时也不能空转；只在实际处理过事件后再读取一次。
        this.requested ||= processed || selected.length > 0;
      }
    } catch (error) {
      this.requested = false;
      if (this.active) {
        logger.error("角色事件调度失败，停止本次调度", { error });
      }
    } finally {
      this.task = undefined;
      if (this.active && this.requested) {
        this.wake();
      }
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.main.stop();
    const results = await Promise.allSettled([
      this.attention.stop(),
      this.execution.control.stop(),
      this.execution.extensions.stop(),
      this.task,
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "角色 agent 停止失败",
      );
    }
  }
}
