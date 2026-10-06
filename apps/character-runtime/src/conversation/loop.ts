import { load_config } from "@yuiju/shared/config/load";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText } from "ai";
import type { Character } from "../character";
import {
  type ConversationMessage,
  type ConversationScope,
  type IncomingEvent,
  renderMessage,
} from "./message";
import type { OneBotConnection } from "./onebot";
import { Planner } from "./planner";
import { Replyer } from "./replyer";
import {
  type ConversationRuntime,
  type ConversationState,
  loadConversationState,
  saveConversationState,
} from "./storage";
import type { ConversationToolContext } from "./tools";
import {
  BACKOFF_DELAYS_MS,
  evaluateTrigger,
  isDirectedMessage,
  RECHECK_INTERVAL_MS,
} from "./trigger";

/** Planner 主动等待的 Unix 毫秒起止时间；定向消息可提前结束等待。 */
export type ConversationWait = { startedAt: number; until: number };

/** 判断阶段只给出输入快照或下次检查时间，不创建定时器、不修改状态。 */
type NextRound = {
  input?: {
    messages: ConversationMessage[];
    history: ConversationMessage[];
    throughSequence: number;
    intentions: { id: string; text: string }[];
  };
  /** 等待实际秒数；0 也表示结束等待。 */
  waitedSeconds?: number;
  nextCheckAt?: number;
};

/** 单群决策串行运行；模型调用期间仍接收消息，状态提交使用同一条短写入队列。 */
export class ConversationLoop {
  private readonly planner: Planner;
  private readonly replyer: Replyer;
  /** 真实收发历史，不含模型工具交互；只保留未消费、未压缩和触发评分需要的记录。 */
  private history: ConversationMessage[] = [];
  /** 业务状态的唯一内存实例，Redis 的 runtime 字段是它的恢复快照。 */
  private runtime: ConversationRuntime = {
    sequence: 0,
    processedThrough: 0,
    plannerInputThrough: 0,
    silentRounds: 0,
    silenceCooldownUntil: 0,
  };
  private acceptingMessages = true;
  /** 恢复和平台连接都完成后才开放调度；连接建立期间只记录消息。 */
  private scheduling = false;
  /** 角色确认可以聊天后才开放；发送前还会再次检查，拦截已在途的生成。 */
  private participationAllowed = false;
  /** Redis 提交失败后停止该会话，避免继续在无法确定的持久化状态上发送。 */
  private persistenceError: Error | undefined;
  /** 队列只覆盖状态变更与提交，不占用模型生成或平台请求的时间。 */
  private stateWriteQueue: Promise<void> = Promise.resolve();
  private runningTask: Promise<void> | undefined;
  private wakeRequested = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly scope: ConversationScope,
    private readonly selfId: string,
    private readonly names: string[],
    private readonly connection: OneBotConnection,
    private readonly character: Character,
  ) {
    this.planner = new Planner(scope);
    this.replyer = new Replyer(scope);
  }

  /** 待处理输入由历史与消费边界派生，避免维护另一份可漂移的队列。 */
  private get pending() {
    return this.history.filter(
      (message) => !message.isSelf && message.sequence > this.runtime.processedThrough,
    );
  }

  /** 主动从 Redis 恢复；缺失 key 才创建新会话，读取和解析错误直接交给启动方。 */
  async initialize(): Promise<void> {
    const state = await loadConversationState(this.scope);
    if (state) {
      this.runtime = state.runtime;
      this.history = state.history;
    }
    await Promise.all([
      this.planner.initialize(
        state ? state.planner : { history: [], summary: { text: "", coveredThrough: 0 } },
      ),
      this.replyer.initialize(state ? state.replyerSummary : { text: "", coveredThrough: 0 }),
    ]);

    if (this.runtime.currentRound?.sendAttempted) {
      // 平台与 Redis 不能组成事务；已尝试发送的中断批次宁可少回复，不自动重放。
      this.runtime.processedThrough = this.runtime.currentRound.throughSequence;
      this.runtime.currentRound = undefined;
      this.runtime.failedThroughSequence = undefined;
      this.runtime.waiting = undefined;
    }
    // 无发送的 currentRound 保留为恢复后的待执行轮次，包括没有新输入的等待续接。
    this.pruneHistory();
    await this.commit({
      runtime: this.runtime,
      history: this.history,
      planner: this.planner.state,
      replyerSummary: this.replyer.summary,
    });
  }

  /** OneBot 可发送后开放调度，恢复 wait 定时器及尚未消费的输入。 */
  resume(): void {
    if (this.persistenceError) throw this.persistenceError;
    this.scheduling = true;
    this.requestRun();
  }

  async receiveIntention(id: string, text: string): Promise<string> {
    if (!this.participationAllowed) {
      return "当前暂停群聊，未提交分享。";
    }
    const release = await this.acquireStateWrite();
    try {
      const intents = this.runtime.shareIntents ?? [];
      if (!this.participationAllowed) {
        return "角色已经暂停群聊，未提交分享。";
      }
      if (intents.some((intent) => intent.id === id)) {
        return "这次分享意图已经交给聊天规划，不重复提交。";
      }
      this.runtime.shareIntents = [
        ...intents.filter(
          (intent) => !intent.consumed || intent.receivedAt >= Date.now() - 30 * 86_400_000,
        ),
        { id, text, consumed: false, receivedAt: Date.now() },
      ];
      await this.commit({ runtime: this.runtime });
      this.requestRun();
      return "已交给这个群的聊天规划；是否发送与如何表达由它决定。";
    } finally {
      release();
    }
  }

  /** 暂停不等待 LLM；恢复先整理固定原文范围，新到消息留给正常 trigger。 */
  async setParticipationAllowed(allowed: boolean): Promise<void> {
    if (!allowed) {
      this.participationAllowed = false;
      clearTimeout(this.wakeTimer);
      const release = await this.acquireStateWrite();
      try {
        if (!this.runtime.paused) {
          this.runtime.paused = {
            summary: this.replyer.summary.text,
            coveredThrough: this.replyer.summary.coveredThrough,
          };
          this.runtime.waiting = undefined;
          await this.commit({ runtime: this.runtime });
        }
      } finally {
        release();
      }
      return;
    }
    if (this.participationAllowed) {
      return;
    }
    await this.runningTask;
    if (this.runtime.paused) {
      await this.summarizePausedMessages();
    }
    this.participationAllowed = true;
    this.requestRun();
  }

  private async summarizePausedMessages(): Promise<void> {
    const through = this.runtime.sequence;
    const config = await load_config();
    const windowTokens = config.llm!.models!.flash!.context_window_tokens!;
    const instructions = await renderPrompt("conversation.paused");
    const timezone = config.app!.timezone!;
    while (this.runtime.paused!.coveredThrough < through) {
      const previous = this.runtime.paused!;
      const batch: ConversationMessage[] = [];
      let bytes = Buffer.byteLength(instructions + previous.summary, "utf8");
      for (const message of this.history.filter(
        (item) => item.sequence > previous.coveredThrough && item.sequence <= through,
      )) {
        const size = Buffer.byteLength(renderMessage(message, timezone), "utf8");
        if (bytes + size >= windowTokens * 0.7) {
          break;
        }
        batch.push(message);
        bytes += size;
      }
      if (!batch.length) {
        throw new Error("暂停聊天的最小消息单位无法放入摘要窗口");
      }
      const result = await generateText({
        model: flashModel,
        instructions,
        maxRetries: 0,
        reasoning: "none",
        prompt: `已有背景：\n${previous.summary}\n\n后续交流：\n${batch.map((message) => renderMessage(message, timezone)).join("\n")}`,
      });
      if (result.finishReason !== "stop" || !result.text.trim()) {
        throw new Error("暂停聊天摘要未正常生成，保留原文及暂停状态");
      }
      const release = await this.acquireStateWrite();
      try {
        this.runtime.paused = {
          summary: result.text.trim(),
          coveredThrough: batch.at(-1)!.sequence,
        };
        await this.commit({ runtime: this.runtime });
      } finally {
        release();
      }
    }
    const paused = this.runtime.paused!;
    await this.replyer.replacePausedSummary({ text: paused.summary, coveredThrough: through });
    const release = await this.acquireStateWrite();
    try {
      this.planner.appendBackground(
        `暂停期间的交流背景（仅供理解后续消息，不追补回复）：\n${paused.summary}`,
      );
      this.runtime.processedThrough = through;
      this.runtime.plannerInputThrough = through;
      this.runtime.currentRound = undefined;
      this.runtime.failedThroughSequence = undefined;
      this.runtime.waiting = undefined;
      this.runtime.paused = undefined;
      this.pruneHistory();
      await this.commit({
        runtime: this.runtime,
        history: this.history,
        planner: this.planner.state,
        replyerSummary: this.replyer.summary,
      });
    } finally {
      release();
    }
  }

  /** 接收只等待 Redis 提交，不等待 Planner、Replyer 或 MongoDB。 */
  async receive(input: IncomingEvent): Promise<void> {
    if (this.persistenceError) throw this.persistenceError;
    if (!this.acceptingMessages) return;
    const release = await this.acquireStateWrite();
    try {
      const message: ConversationMessage = { ...input, sequence: ++this.runtime.sequence };
      this.history.push(message);
      if (!this.runningTask && !this.runtime.paused) {
        this.replyer.observe(this.history);
      }
      this.pruneHistory();
      await this.commit(
        {
          runtime: this.runtime,
          history: this.history,
          replyerSummary: this.replyer.summary,
        },
        [message],
      );
      this.requestRun();
    } finally {
      release();
    }
  }

  /** 真实发送先写入内存和本轮快照；保存失败也不能抹去平台确认的事实。 */
  private async recordSent(
    inputs: IncomingEvent[],
    roundHistory: ConversationMessage[],
  ): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      const messages = inputs.map(
        (input): ConversationMessage => ({ ...input, sequence: ++this.runtime.sequence }),
      );
      this.history.push(...messages);
      roundHistory.push(...messages);
      this.runtime.silentRounds = 0;
      this.runtime.silenceCooldownUntil = 0;
      await this.commit({ runtime: this.runtime, history: this.history }, messages);
    } finally {
      release();
    }
  }

  /** 每次工具发送前等待此提交；并发 poke 与 reply 也不能绕过持久化边界。 */
  private async beforeSend(): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      if (!this.participationAllowed) {
        throw new Error("角色当前暂停群聊，不能发送消息");
      }
      this.runtime.currentRound!.sendAttempted = true;
      await this.commit({ runtime: this.runtime });
    } finally {
      release();
    }
  }

  /** 完整模型步骤或压缩后的上下文才可提交，不保存孤立的工具调用。 */
  private async savePlannerContext(): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      await this.commit({ planner: this.planner.state });
    } finally {
      release();
    }
  }

  /** 摘要与它对应的原文裁剪必须一起提交，避免恢复后丢失未覆盖的原文。 */
  private async saveReplyerSummary(): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      this.pruneHistory();
      await this.commit({ history: this.history, replyerSummary: this.replyer.summary });
    } finally {
      release();
    }
  }

  /** 只在初始化或持有写入队列时调用；失败后停止调度，不自动重放不确定的提交。 */
  private async commit(
    changes: Partial<ConversationState>,
    events: ConversationMessage[] = [],
  ): Promise<void> {
    if (this.persistenceError) throw this.persistenceError;
    try {
      await saveConversationState(this.scope, changes, events);
    } catch (error) {
      this.persistenceError = new Error("会话 Redis 提交失败，已停止接收和调度", { cause: error });
      this.acceptingMessages = false;
      this.scheduling = false;
      clearTimeout(this.wakeTimer);
      logger.error(this.persistenceError.message, { ...this.scope, error });
      throw this.persistenceError;
    }
  }

  /** 在 await 前登记队列位置；调用方必须在 finally 中放行下一次状态变更。 */
  private async acquireStateWrite(): Promise<() => void> {
    const previousWrite = this.stateWriteQueue;
    let release!: () => void;
    this.stateWriteQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    return release;
  }

  private requestRun(): void {
    if (!this.scheduling || !this.participationAllowed) {
      return;
    }
    this.wakeRequested = true;
    if (!this.runningTask) this.runningTask = this.runTask();
  }

  /** 统一收口后台调度的异常，并接住任务退出时到达的新唤醒。 */
  private async runTask(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error("群会话调度失败", { ...this.scope, error });
    } finally {
      this.runningTask = undefined;
      if (this.wakeRequested) this.requestRun();
    }
  }

  private getNextRound(now: number): NextRound {
    const pending = this.pending;
    const intentions = (this.runtime.shareIntents ?? []).filter((intent) => !intent.consumed);
    const { waiting, failedThroughSequence, currentRound } = this.runtime;
    const directed = pending.some((message) => isDirectedMessage(message, this.selfId, this.names));
    let waitedSeconds: number | undefined;
    if (waiting) {
      if (now < waiting.until && !directed && !intentions.length) {
        return { nextCheckAt: waiting.until };
      }
      waitedSeconds = (now - waiting.startedAt) / 1000;
    }
    if (!pending.length && !intentions.length && waitedSeconds === undefined && !currentRound) {
      return {};
    }
    if (
      failedThroughSequence !== undefined &&
      !intentions.length &&
      !pending.some((message) => message.sequence > failedThroughSequence)
    ) {
      return { waitedSeconds };
    }
    const trigger = evaluateTrigger({
      pending,
      history: this.history,
      directed,
      nextEligibleAt: this.runtime.silenceCooldownUntil,
      now,
    });
    if (!currentRound && !intentions.length && waitedSeconds === undefined && !trigger.shouldRun) {
      return { nextCheckAt: trigger.shouldRecheck ? now + RECHECK_INTERVAL_MS : undefined };
    }
    const throughSequence = pending.at(-1)?.sequence ?? this.runtime.processedThrough;
    return {
      input: {
        messages: pending,
        history: this.history.filter(
          (message) => message.sequence <= throughSequence || message.isSelf,
        ),
        throughSequence,
        intentions,
      },
      waitedSeconds,
    };
  }

  /** 状态判断与输入提交在队列中完成，释放队列后才调用模型。 */
  private async run(): Promise<void> {
    clearTimeout(this.wakeTimer);
    while (this.scheduling && this.participationAllowed && this.wakeRequested) {
      this.wakeRequested = false;
      let next: NextRound;
      const release = await this.acquireStateWrite();
      try {
        if (!this.scheduling || !this.participationAllowed) {
          return;
        }
        next = this.getNextRound(Date.now());
        if (next.waitedSeconds !== undefined) this.runtime.waiting = undefined;
        if (!next.input) {
          if (next.waitedSeconds !== undefined) await this.commit({ runtime: this.runtime });
          if (this.scheduling && next.nextCheckAt !== undefined) {
            this.wakeTimer = setTimeout(() => this.requestRun(), next.nextCheckAt - Date.now());
          }
          return;
        }
        const { messages, throughSequence } = next.input;
        if (messages.length >= 6) this.runtime.silenceCooldownUntil = 0;
        this.runtime.currentRound = { throughSequence, sendAttempted: false };
        const newMessages = messages.filter(
          (message) => message.sequence > this.runtime.plannerInputThrough,
        );
        this.planner.appendInput(newMessages, next.waitedSeconds);
        for (const intention of next.input.intentions) {
          this.planner.appendBackground(
            `你想与这个群分享的事情（由你判断现在是否适合表达）：${intention.text}`,
          );
          this.runtime.shareIntents!.find((intent) => intent.id === intention.id)!.consumed = true;
        }
        this.runtime.plannerInputThrough = throughSequence;
        await this.commit({
          runtime: this.runtime,
          ...((newMessages.length > 0 ||
            next.waitedSeconds !== undefined ||
            next.input.intentions.length > 0) && {
            planner: this.planner.state,
          }),
        });
      } finally {
        release();
      }

      const execution = await this.runRound(next.input);
      const finishWrite = await this.acquireStateWrite();
      try {
        if (this.persistenceError) throw this.persistenceError;
        if (!execution.failed || execution.sendAttempted || execution.waitSeconds !== undefined) {
          this.runtime.processedThrough = next.input.throughSequence;
          this.runtime.failedThroughSequence = undefined;
        } else {
          this.runtime.failedThroughSequence = next.input.throughSequence;
        }
        if (execution.waitSeconds !== undefined) {
          const startedAt = Date.now();
          this.runtime.waiting = { startedAt, until: startedAt + execution.waitSeconds * 1000 };
          this.runtime.silentRounds = 0;
          this.runtime.silenceCooldownUntil = 0;
        } else if (!execution.failed && !execution.sendAttempted) {
          this.runtime.silentRounds += 1;
          if (this.runtime.silentRounds >= 2) {
            this.runtime.silenceCooldownUntil =
              Date.now() +
              BACKOFF_DELAYS_MS[
                Math.min(this.runtime.silentRounds - 2, BACKOFF_DELAYS_MS.length - 1)
              ];
          }
        }
        this.runtime.currentRound = undefined;
        if (!this.runtime.paused) {
          this.replyer.observe(this.history);
        }
        this.pruneHistory();
        await this.commit({
          runtime: this.runtime,
          history: this.history,
          replyerSummary: this.replyer.summary,
        });
        this.wakeRequested =
          this.pending.length > 0 ||
          this.runtime.waiting !== undefined ||
          (this.runtime.shareIntents ?? []).some((intent) => !intent.consumed);
      } finally {
        finishWrite();
      }
    }
  }

  /** 工具通过具名回调提交副作用；模型失败不抹去已确认的发送结果。 */
  private async runRound(input: NonNullable<NextRound["input"]>): Promise<ConversationToolContext> {
    const execution: ConversationToolContext = {
      connection: this.connection,
      replyer: this.replyer,
      history: input.history,
      historyThrough: input.history.at(-1)?.sequence ?? 0,
      beforeSend: async () => await this.beforeSend(),
      recordSent: async (events) => await this.recordSent(events, input.history),
      saveReplyerSummary: async () => await this.saveReplyerSummary(),
      sendAttempted: false,
      failed: false,
      canParticipate: () => this.participationAllowed,
      readCharacter: async () => await this.character.readConversationContext(),
      notifyCharacter: async (description, messageIds) =>
        await this.character.notifyFromConversation(this.scope, description, messageIds),
    };
    try {
      await this.planner.run(execution, async () => await this.savePlannerContext());
    } catch (error) {
      execution.failed = true;
      logger.error("聊天工具循环失败", { ...this.scope, error });
    }
    return execution;
  }

  private pruneHistory(): void {
    const recentSince = Date.now() - 300_000;
    this.history = this.history.filter(
      (message) =>
        (!message.isSelf && message.sequence > this.runtime.processedThrough) ||
        message.sequence > this.replyer.summary.coveredThrough ||
        message.timestamp >= recentSince,
    );
  }

  /** 停止新输入与调度，等待在途轮次和压缩，最终快照仍必须等待 Redis 确认。 */
  async stop(): Promise<void> {
    this.acceptingMessages = false;
    this.scheduling = false;
    clearTimeout(this.wakeTimer);
    await this.runningTask;
    await this.stateWriteQueue;
    await Promise.all([this.planner.stop(), this.replyer.stop()]);
    this.pruneHistory();
    await this.commit({
      runtime: this.runtime,
      history: this.history,
      planner: this.planner.state,
      replyerSummary: this.replyer.summary,
    });
  }
}
