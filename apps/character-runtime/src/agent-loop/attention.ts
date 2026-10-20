import { logger } from "@yuiju/shared/logger/logger";
import { nextPlanAttention, signalPlansDue } from "../plan/plan";
import { readActivityWait, signalActivityDue } from "./events";

/** 角色宿主的活动与计划时钟；主 agent 等待进入或场景思考时仍继续运行。 */
export class CharacterAttention {
  private active = false;
  private requested = false;
  private task: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly characterId: string,
    private readonly wake: () => void,
  ) {}

  start(): void {
    this.active = true;
    this.schedule();
  }

  /** 活动或计划变更后重新读取最早关注时间；合并并发请求，不与模型调用互相等待。 */
  schedule(): void {
    this.requested = true;
    if (this.active && !this.task) {
      clearTimeout(this.timer);
      this.task = this.run();
    }
  }

  private async run(): Promise<void> {
    try {
      while (this.active && this.requested) {
        this.requested = false;
        await signalActivityDue(this.characterId, Date.now());
        await signalPlansDue(this.characterId, Date.now());
        if (!this.active) {
          return;
        }
        this.wake();
        const [activity, planAt] = await Promise.all([
          readActivityWait(this.characterId),
          nextPlanAttention(this.characterId),
        ]);
        const times = [activity?.checkAt, planAt].filter((time): time is number => time != null);
        clearTimeout(this.timer);
        if (this.active && times.length) {
          this.timer = setTimeout(
            () => this.schedule(),
            Math.min(2_147_483_647, Math.max(0, Math.min(...times) - Date.now())),
          );
        }
      }
    } catch (error) {
      this.requested = false;
      clearTimeout(this.timer);
      logger.error("角色关注时间调度失败，不再重试", { error });
    } finally {
      this.task = undefined;
      if (this.active && this.requested) {
        this.schedule();
      }
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    await this.task;
  }
}
