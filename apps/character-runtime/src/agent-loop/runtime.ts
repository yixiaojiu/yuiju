import { logger } from "@yuiju/shared/logger/logger";
import { CharacterAttention } from "./attention";
import { readCharacterEvents } from "./events";
import { MainAgentLoop } from "./main";
import type { AgentToolContext } from "./tools";

/** 主 agent 的事件调度器；场景占用控制权期间保留收件箱，不参与扩展的 loop。 */
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
    if (this.active && !this.task && this.execution.control.phase === "main") {
      this.task = this.run();
    }
  }

  private async run(): Promise<void> {
    const { characterId, control } = this.execution;
    try {
      while (this.active && this.requested) {
        this.requested = false;
        // 交接期间不消费 main 的输入；扩展退出后由 main 继续处理。
        if (control.phase !== "main") {
          return;
        }
        const batch = await readCharacterEvents(characterId);
        if (!this.active) {
          return;
        }
        if (control.entryRequested) {
          control.beginEntry();
          return;
        }
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
          if (this.active) {
            control.beginEntry();
          }
          throw error;
        }
        this.requested = true;
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
