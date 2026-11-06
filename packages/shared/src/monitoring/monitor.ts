import { type MonitoringAlert, writeMonitoringAlert } from "./storage";

type BusinessMonitorOptions = {
  monitorKey: string;
  app: string;
  characterId?: string;
  channelId?: string;
  severity: MonitoringAlert["severity"];
  title: string;
  impact: string;
  /** 连续多少次失败后告警；成功只清空计数，不重置冷却。 */
  failureThreshold: number;
  /** 同一实例两次告警之间的最短间隔，单位毫秒。 */
  cooldownMs: number;
};

/** 一个业务检测项的进程内状态；业务方负责判断结果，实例只计数、限频并发出告警。 */
export class BusinessMonitor {
  private readonly options: BusinessMonitorOptions;
  private consecutiveFailures = 0;
  private lastAlertAt: number | undefined;

  constructor(options: BusinessMonitorOptions) {
    this.options = options;
  }

  /** 一次成功观测结束连续失败；不修改历史记录，也不提前结束告警冷却。 */
  success(): void {
    this.consecutiveFailures = 0;
  }

  /** 同步更新计数与冷却，再后台写库；调用方无需等待，不保存传入异常的完整对象。 */
  failure(input: { message: string }): void {
    this.consecutiveFailures += 1;
    const now = Date.now();
    if (
      this.consecutiveFailures < this.options.failureThreshold ||
      (this.lastAlertAt !== undefined && now - this.lastAlertAt < this.options.cooldownMs)
    ) {
      return;
    }
    // 在任何 await 之前占用冷却，避免并发失败在数据库返回前重复产生告警。
    this.lastAlertAt = now;
    writeMonitoringAlert({
      monitor_key: this.options.monitorKey,
      app: this.options.app,
      ...(this.options.characterId !== undefined && { character_id: this.options.characterId }),
      ...(this.options.channelId !== undefined && { channel_id: this.options.channelId }),
      severity: this.options.severity,
      title: this.options.title,
      impact: this.options.impact,
      message: input.message,
      consecutive_failures: this.consecutiveFailures,
      created_at: new Date(now),
    });
  }
}
