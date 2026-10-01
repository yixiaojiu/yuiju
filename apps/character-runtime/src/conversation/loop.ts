import { logger } from "@yuiju/shared/logger/logger";
import type { ConversationMessage, ConversationScope, IncomingEvent } from "./message";
import type { OneBotConnection } from "./onebot";
import { Planner } from "./planner";
import { Replyer } from "./replyer";
import {
  queryConversationMessages,
  saveConversationMessage,
  saveConversationState,
} from "./storage";
import type { ConversationToolContext } from "./tools";
import {
  BACKOFF_DELAYS_MS,
  evaluateTrigger,
  isDirectedMessage,
  RECHECK_INTERVAL_MS,
} from "./trigger";

/** Planner 选择的主动等待；定向消息可提前结束等待。时间单位为 Unix 毫秒。 */
export type ConversationWait = {
  /** 开始等待的时间，用于告知 Planner 实际等待了多久。 */
  startedAt: number;
  /** 预计结束时间，到期后即使没有新消息也继续判断。 */
  until: number;
};

/** 一次调度判断：有 input 就执行；否则按 nextCheckAt 复查，未给时间则等新消息。 */
type NextRound = {
  /** 可以执行时固定的输入快照；与 nextCheckAt 不同时返回。 */
  input?: {
    /** 本轮准备处理的外部消息，不含执行期间新到的消息。 */
    messages: ConversationMessage[];
    /** 本轮回复可见的收发历史。 */
    history: ConversationMessage[];
    /** 本批输入的末尾序号；等待到期且无新消息时沿用已处理位置。 */
    throughSequence: number;
  };
  /** 主动等待已到期或被打断时的实际秒数；0 也表示等待结束。 */
  waitedSeconds?: number;
  /** 下次复查的 Unix 毫秒时间；只返回时间，不在判断过程中创建定时器。 */
  nextCheckAt?: number;
};

/** 单个群的串行决策循环；模型运行期间仍接收消息，留到下一轮处理。 */
export class ConversationLoop {
  /** 当前群的工具循环与上下文，通过 tool message 感知执行结果。 */
  private readonly planner: Planner;
  /** 当前群的回复生成与摘要，轮次执行期间不吸收新输入的压缩结果。 */
  private readonly replyer: Replyer;
  /** 已接收和已发送的事件；轮次结束或旁听时裁剪已压缩的旧记录。 */
  private history: ConversationMessage[] = [];
  /** 尚未处理的外部输入；新消息追加，成功处理后按本轮边界移除。 */
  private pending: ConversationMessage[] = [];
  /** 收发事件共用的最新序号；从历史末尾恢复，每次记录事件时递增。 */
  private sequence = 0;
  /** 已消费的外部输入位置；只有轮次返回 processed 时推进，不因失败回退。 */
  private processedThrough = 0;
  /** Planner 选择 wait 时设置；到期或被定向消息打断后清除。 */
  private waiting: ConversationWait | undefined;
  /** 失败时已知的输入边界；必须收到更晚的消息才能再规划，轮次处理完成后清除。 */
  private failedThroughSequence: number | undefined;
  /** 连续主动沉默的轮数；选择等待或平台确认发送后归零，生成失败不算沉默。 */
  private silentRounds = 0;
  /** 普通消息的沉默退避截止时间（Unix 毫秒）；0 表示无退避，定向消息可绕过。 */
  private silenceCooldownUntil = 0;

  /** stop 时关闭；之后不再接收输入或启动新轮次，在途轮次仍完成。 */
  private acceptingMessages = true;
  /** 首条消息触发的初始化任务；并发接收共用它，完成前不记录新输入。 */
  private initializationTask: Promise<void> | undefined;
  /** 收发共用的队列尾部；每项在 finally 中放行，只表示写入结束，不携带业务错误。 */
  private messageWriteQueue: Promise<void> = Promise.resolve();
  /** 当前群唯一的循环任务；存在时仅记下唤醒请求，停止时等待其完成。 */
  private runningTask: Promise<void> | undefined;
  /** 新消息或定时器设置；每次调度判断前清除，保留任务退出期间到达的唤醒。 */
  private wakeRequested = false;
  /** 主动等待或冷场复查的定时器；开始运行或停止时取消。 */
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly scope: ConversationScope,
    private readonly selfId: string,
    private readonly names: string[],
    private readonly connection: OneBotConnection,
  ) {
    this.planner = new Planner(scope);
    this.replyer = new Replyer(scope);
  }

  /** 读取历史并准备两个模型上下文；旧历史仅作为背景，不重新触发回复。 */
  private async initialize() {
    this.history = await queryConversationMessages(this.scope, { after: 0 });
    this.sequence = this.history.at(-1)?.sequence ?? 0;
    // 启动时读取的历史只提供背景，不重新触发旧消息的回复。
    this.processedThrough = this.sequence;
    await Promise.all([this.planner.initialize(), this.replyer.initialize()]);
  }

  /**
   * 将外部输入排入写入队列，落库后加入待处理消息并唤醒循环。
   * 返回值只等待输入记录，不等待模型回复；落库失败交给接入方报告。
   */
  async receive(input: IncomingEvent): Promise<void> {
    if (!this.acceptingMessages) {
      return;
    }
    this.initializationTask ??= this.initialize();
    const release = await this.acquireMessageWrite();
    try {
      await this.initializationTask;
      const message: ConversationMessage = { ...input, sequence: ++this.sequence };

      // 收到消息先落库，成功后才成为会话的待处理输入。
      await saveConversationMessage(this.scope, message);
      this.history.push(message);
      this.pending.push(message);

      // 当前轮次结束前不把新到消息压进 Replyer 摘要，保持本轮输入快照。
      if (!this.runningTask) {
        this.replyer.observe(this.history);
      }
      this.pruneHistory();
      this.requestRun();
    } finally {
      release();
    }
  }

  /**
   * 平台确认后先保留真实历史与本轮快照、重置退避，再落库。
   * 写入失败不抹去已发送事实；工具通过 return 将记录及失败情况交给 Planner。
   */
  private async recordSent(
    inputs: IncomingEvent[],
    roundHistory: ConversationMessage[],
  ): Promise<void> {
    const release = await this.acquireMessageWrite();
    try {
      const messages = inputs.map(
        (input): ConversationMessage => ({ ...input, sequence: ++this.sequence }),
      );
      this.history.push(...messages);
      roundHistory.push(...messages);
      this.silentRounds = 0;
      this.silenceCooldownUntil = 0;
      for (const message of messages) {
        await saveConversationMessage(this.scope, message);
      }
    } finally {
      release();
    }
  }

  /**
   * 先同步登记当前写入的位置，再等待前一项结束，保证并发调用按到达顺序执行。
   * @returns 放行下一项的函数，调用方必须在 finally 中调用；业务错误直接向上抛出。
   */
  private async acquireMessageWrite(): Promise<() => void> {
    const previousWrite = this.messageWriteQueue;
    // Promise 的 executor 同步执行，在 await 之前完成队列登记和 release 赋值。
    let release!: () => void;
    this.messageWriteQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    return release;
  }

  /** 合并消息和定时器的唤醒请求；已有任务时不启动第二个循环。 */
  private requestRun() {
    if (!this.acceptingMessages) {
      return;
    }
    this.wakeRequested = true;
    if (this.runningTask) {
      return;
    }
    this.runningTask = this.runTask();
  }

  /** 管理运行任务的异常与退出交接；await 确保清理发生在 runningTask 赋值之后。 */
  private async runTask() {
    try {
      await this.run();
    } catch (error) {
      logger.error("群会话调度失败", { ...this.scope, error });
    } finally {
      this.runningTask = undefined;
      // 接住 run 返回到任务清理之间到达的新唤醒。
      if (this.wakeRequested) {
        this.requestRun();
      }
    }
  }

  /**
   * 依次检查主动等待、失败后新输入和触发评分，并固定本轮输入。
   * 只读取当前状态；清除等待、设置定时器和执行轮次都由 run 负责。
   * @param now 本次判断的 Unix 毫秒时间。
   * @returns 可执行的输入、下次检查时间，或空结果（只等新消息）。
   */
  private getNextRound(now: number): NextRound {
    const directed = this.pending.some((message) =>
      isDirectedMessage(message, this.selfId, this.names),
    );
    let waitedSeconds: number | undefined;
    if (this.waiting) {
      if (now < this.waiting.until && !directed) {
        return { nextCheckAt: this.waiting.until };
      }
      waitedSeconds = (now - this.waiting.startedAt) / 1000;
    }

    if (!this.pending.length && waitedSeconds === undefined) {
      return {};
    }
    const failedThroughSequence = this.failedThroughSequence;
    if (
      failedThroughSequence !== undefined &&
      !this.pending.some((message) => message.sequence > failedThroughSequence)
    ) {
      return { waitedSeconds };
    }

    const trigger = evaluateTrigger({
      pending: this.pending,
      history: this.history,
      directed,
      nextEligibleAt: this.silenceCooldownUntil,
      now,
    });
    if (waitedSeconds === undefined && !trigger.shouldRun) {
      return { nextCheckAt: trigger.shouldRecheck ? now + RECHECK_INTERVAL_MS : undefined };
    }

    const messages = [...this.pending];
    const throughSequence = messages.at(-1)?.sequence ?? this.processedThrough;
    return {
      input: {
        messages,
        history: this.history.filter(
          (message) => message.sequence <= throughSequence || message.isSelf,
        ),
        throughSequence,
      },
      waitedSeconds,
    };
  }

  /** 判断下一轮、执行、推进处理位置、维护上下文并保存状态；新输入留到下一轮。 */
  private async run() {
    clearTimeout(this.wakeTimer);
    while (this.acceptingMessages && this.wakeRequested) {
      this.wakeRequested = false;
      const next = this.getNextRound(Date.now());
      if (next.waitedSeconds !== undefined) {
        this.waiting = undefined;
      }
      if (!next.input) {
        if (next.nextCheckAt !== undefined) {
          this.wakeTimer = setTimeout(() => this.requestRun(), next.nextCheckAt - Date.now());
        }
        return;
      }

      // 触发器已允许六条积压绕过退避；执行前清除旧截止时间。
      if (next.input.messages.length >= 6) {
        this.silenceCooldownUntil = 0;
      }
      const { messages, history, throughSequence } = next.input;
      const result = await this.runRound(messages, history, next.waitedSeconds);
      if (result === "processed") {
        this.pending = this.pending.filter((message) => message.sequence > throughSequence);
        this.processedThrough = throughSequence;
        this.failedThroughSequence = undefined;
      } else {
        this.failedThroughSequence = throughSequence;
      }

      this.replyer.observe(this.history);
      this.pruneHistory();
      try {
        await saveConversationState(this.scope, {
          processedThrough: this.processedThrough,
          planner: this.planner.state,
          replyerSummary: this.replyer.summary,
          waiting: this.waiting,
          failedThroughSequence: this.failedThroughSequence,
          silentRounds: this.silentRounds,
          silenceCooldownUntil: this.silenceCooldownUntil,
        });
      } catch (error) {
        // 状态写入失败不能回退已消费位置；等新消息后再判断，避免重发已执行的行动。
        logger.error("聊天会话状态保存失败", { ...this.scope, stage: "save-state", error });
        this.failedThroughSequence = this.pending.at(-1)?.sequence ?? throughSequence;
        return;
      }
      this.wakeRequested = this.pending.length > 0 || this.waiting !== undefined;
    }
  }

  /**
   * 运行一轮工具循环，随后安排等待、维护退避并决定是否消费本批输入。
   * 已尝试平台发送的批次不能重跑；未发送的失败批次保留，等新消息后再判断。
   */
  private async runRound(
    messages: ConversationMessage[],
    history: ConversationMessage[],
    waitedSeconds?: number,
  ): Promise<"processed" | "retry"> {
    const execution: ConversationToolContext = {
      connection: this.connection,
      replyer: this.replyer,
      history,
      historyThrough: history.at(-1)?.sequence ?? 0,
      recordSent: async (events) => await this.recordSent(events, history),
      sendAttempted: false,
      failed: false,
    };
    try {
      await this.planner.run(messages, execution, waitedSeconds);
      if (execution.waitSeconds !== undefined) {
        const startedAt = Date.now();
        this.waiting = { startedAt, until: startedAt + execution.waitSeconds * 1000 };
        this.silentRounds = 0;
        this.silenceCooldownUntil = 0;
        return "processed";
      }
      if (execution.failed) {
        return execution.sendAttempted ? "processed" : "retry";
      }
      if (!execution.sendAttempted) {
        this.silentRounds += 1;
        if (this.silentRounds >= 2) {
          this.silenceCooldownUntil =
            Date.now() +
            BACKOFF_DELAYS_MS[Math.min(this.silentRounds - 2, BACKOFF_DELAYS_MS.length - 1)];
        }
      }
      return "processed";
    } catch (error) {
      logger.error("聊天工具循环失败", { ...this.scope, error });
      return execution.sendAttempted ? "processed" : "retry";
    }
  }

  /** 保留未处理输入、未压缩原文，以及触发评分所需的近五分钟消息。 */
  private pruneHistory() {
    const recentSince = Date.now() - 300_000;
    const coveredThrough = this.replyer.summary.coveredThrough;
    this.history = this.history.filter(
      (message) =>
        message.sequence > this.processedThrough ||
        message.sequence > coveredThrough ||
        message.timestamp >= recentSince,
    );
  }

  /** 关闭接收与定时唤醒，等待在途写入、当前轮次、初始化和后台压缩自然结束。 */
  async stop() {
    this.acceptingMessages = false;
    clearTimeout(this.wakeTimer);
    await this.messageWriteQueue;
    await this.runningTask;
    await this.initializationTask;
    await Promise.all([this.planner.stop(), this.replyer.stop()]);
  }
}
