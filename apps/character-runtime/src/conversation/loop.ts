import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import type { Character } from "../character";
import { COMMUNICATION_RETENTION_MS } from "../communication";
import type { ConversationInputEvent } from "./events";
import {
  type ConversationMessage,
  type ConversationScope,
  type IncomingEvent,
  renderMessage,
  visibleText,
} from "./message";
import type { OneBotConnection } from "./onebot";
import { summarizePausedBackground } from "./paused-background";
import { Planner } from "./planner/planner";
import type { ConversationToolContext } from "./planner/tools";
import {
  BACKOFF_DELAYS_MS,
  evaluateTrigger,
  getNextRound,
  isDirectedMessage,
  RECHECK_INTERVAL_MS,
} from "./planner/trigger";
import { Replyer } from "./reply/replyer";
import type { StickerCollection } from "./sticker/collection";
import type { PendingSticker } from "./sticker/schema";
import {
  type ChannelRuntime,
  type ChannelState,
  loadChannelState,
  loadPlannerState,
  type PlannerAgentEvent,
  type PlannerRuntime,
  type PlannerState,
  saveChannelState,
  savePlannerState,
} from "./storage/redis";

/** Planner 主动等待的 Unix 毫秒起止时间；普通用户的定向消息可提前结束等待。 */
export type ConversationWait = { startedAt: number; until: number };

export type ConversationChannelConfig = {
  channelId: string;
  collectTrainingData: boolean;
  checkReplyQuality: boolean;
};

/** 切回长时间未关注的群时，超过该条数先摘要较早消息，仅保留最新部分作活跃未读。 */
const UNFOCUSED_SUMMARY_THRESHOLD = 30;
const UNFOCUSED_KEEP_RECENT = 15;

type ChannelSession = {
  scope: ConversationScope;
  name: string;
  replyer: Replyer;
  history: ConversationMessage[];
  runtime: ChannelRuntime;
  enabled: boolean;
  resumingTask?: Promise<void>;
};

type BackgroundNotice = {
  channel: ChannelSession;
  latestSequence: number;
  shouldWake: boolean;
  nextCheckAt?: number;
  line: string;
};

/** 角色级唯一聊天主循环：单 Planner 维护注意力与跨群切换，各群保持独立历史与 Replyer。 */
export class ConversationLoop {
  private readonly planner: Planner;
  private readonly channels = new Map<string, ChannelSession>();
  /** 角色级 Planner 运行态，Redis 的 planner key 是它的恢复快照。 */
  private plannerRuntime: PlannerRuntime = {
    focusedChannelId: null,
  };
  private acceptingMessages = true;
  /** 恢复和平台连接都完成后才开放调度；连接建立期间只记录消息。 */
  private scheduling = false;
  /** 睡眠或进入互动场景时全局暂停，与各群人工开关正交。 */
  private activityAllowsParticipation = false;
  /** Redis 提交失败后停止整个聊天调度，避免在无法确定的持久化状态上继续发送。 */
  private persistenceError: Error | undefined;
  /** 所有状态变更与 Redis 提交共用同一条短写入队列，不占用模型或平台请求时间。 */
  private stateWriteQueue: Promise<void> = Promise.resolve();
  private runningTask: Promise<void> | undefined;
  private wakeRequested = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly characterId: string,
    private readonly platform: ConversationScope["platform"],
    channelConfigs: readonly ConversationChannelConfig[],
    private readonly selfId: string,
    private readonly names: string[],
    private readonly connection: OneBotConnection,
    private readonly character: Character,
    private readonly botIds: readonly string[],
    private readonly stickers: StickerCollection,
  ) {
    this.planner = new Planner(characterId, platform, botIds);
    for (const channelConfig of channelConfigs) {
      const scope: ConversationScope = {
        characterId,
        platform,
        channelId: channelConfig.channelId,
      };
      this.channels.set(channelConfig.channelId, {
        scope,
        name: channelConfig.channelId,
        replyer: new Replyer(
          scope,
          channelConfig.collectTrainingData,
          botIds,
          channelConfig.checkReplyQuality,
        ),
        history: [],
        runtime: {
          sequence: 0,
          processedThrough: 0,
          plannerInputThrough: 0,
          silentRounds: 0,
          silenceCooldownUntil: 0,
        },
        enabled: true,
      });
    }
  }

  get focusedChannelId(): string | null {
    return this.plannerRuntime.focusedChannelId;
  }

  hasChannel(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  setChannelName(channelId: string, name: string): void {
    const channel = this.channels.get(channelId);
    if (channel && name.trim()) {
      channel.name = name.trim();
    }
  }

  private pendingOf(channel: ChannelSession): ConversationMessage[] {
    return channel.history.filter(
      (message) => !message.isSelf && message.sequence > channel.runtime.processedThrough,
    );
  }

  private isChannelRunnable(channel: ChannelSession): boolean {
    return (
      channel.enabled &&
      this.activityAllowsParticipation &&
      !channel.runtime.paused &&
      !channel.resumingTask
    );
  }

  /** 主动从 Redis 恢复唯一 Planner 和白名单内各群状态；读取和解析错误直接交给启动方。 */
  async initialize(): Promise<void> {
    const [plannerState, channelEntries] = await Promise.all([
      loadPlannerState(this.characterId, this.platform),
      Promise.all(
        [...this.channels.values()].map(async (channel) => ({
          channel,
          state: await loadChannelState(channel.scope),
        })),
      ),
    ]);
    if (plannerState) {
      this.plannerRuntime = plannerState.runtime;
    }
    for (const { channel, state } of channelEntries) {
      if (state) {
        channel.runtime = state.runtime;
        channel.history = state.history;
      }
    }
    await Promise.all([
      this.planner.initialize(
        plannerState
          ? plannerState.planner
          : { history: [], summary: { text: "", coveredThrough: 0 } },
      ),
      ...channelEntries.map(({ channel, state }) =>
        channel.replyer.initialize(state ? state.replyerSummary : { text: "", coveredThrough: 0 }),
      ),
    ]);

    if (
      this.plannerRuntime.focusedChannelId !== null &&
      !this.channels.has(this.plannerRuntime.focusedChannelId)
    ) {
      this.plannerRuntime.focusedChannelId = null;
      this.plannerRuntime.focusAnnouncementPending = undefined;
      this.plannerRuntime.waiting = undefined;
    }

    const interrupted = this.plannerRuntime.currentRound;
    if (interrupted) {
      const channel = this.channels.get(interrupted.channelId);
      if (!channel) {
        this.plannerRuntime.currentRound = undefined;
        this.plannerRuntime.waiting = undefined;
      } else if (interrupted.sendAttempted) {
        // 平台与 Redis 不能组成事务；已尝试发送或 Skill 写入的中断批次不自动重放。
        channel.runtime.processedThrough = interrupted.throughSequence;
        channel.runtime.failedThroughSequence = undefined;
        this.plannerRuntime.currentRound = undefined;
        this.plannerRuntime.waiting = undefined;
      }
    }

    for (const channel of this.channels.values()) {
      this.pruneHistory(channel);
    }
    await this.commitPlanner({
      runtime: this.plannerRuntime,
      planner: this.planner.state,
    });
    await Promise.all(
      [...this.channels.values()].map((channel) =>
        this.commitChannel(channel, {
          runtime: channel.runtime,
          history: channel.history,
          replyerSummary: channel.replyer.summary,
        }),
      ),
    );
  }

  /** OneBot 可发送后开放调度，恢复 wait 定时器及尚未消费的输入。 */
  resume(): void {
    if (this.persistenceError) {
      throw this.persistenceError;
    }
    this.scheduling = true;
    this.requestRun();
  }

  async restoreStickerKeys(): Promise<void> {
    for (const channel of this.channels.values()) {
      for (const message of channel.history) {
        if (message.kind === "message") {
          await this.stickers.observeMessage(message.content);
        }
      }
    }
  }

  /** 角色级内部事件统一交给唯一 Planner；忙碌时留到下一轮，暂停时保留到恢复。 */
  async receiveAgentEvent(event: ConversationInputEvent, channelId?: string): Promise<string> {
    const release = await this.acquireStateWrite();
    try {
      if (this.persistenceError) {
        throw this.persistenceError;
      }
      if (!this.acceptingMessages) {
        throw new Error("会话已经停止接收事件");
      }
      if (channelId !== undefined && !this.channels.has(channelId)) {
        return `未投递：来源 QQ 群 ${channelId} 当前未接入。`;
      }
      const events = this.plannerRuntime.agentEvents ?? [];
      if (events.some((received) => received.id === event.id)) {
        return `事件已投递，不重复提交。事件 ID：${event.id}`;
      }
      this.plannerRuntime.agentEvents = [
        ...events.filter(
          (received) =>
            !received.consumed || received.occurredAt >= Date.now() - COMMUNICATION_RETENTION_MS,
        ),
        { ...event, ...(channelId !== undefined && { channelId }), consumed: false },
      ];
      await this.commitPlanner({ runtime: this.plannerRuntime });
      this.requestRun();
      return `已投递给群聊 Planner，事件 ID：${event.id}。是否、在哪个群发送由它决定。`;
    } finally {
      release();
    }
  }

  /** 启动只投递未被待消费事件覆盖的收藏；事件消费不等于标注完成。 */
  async receiveStickerAnnotations(pending: PendingSticker[]): Promise<void> {
    const covered = new Set(
      (this.plannerRuntime.agentEvents ?? []).flatMap((event) =>
        event.type === "sticker_annotation" && !event.consumed ? event.resIds : [],
      ),
    );
    const remaining = pending.filter((sticker) => !covered.has(sticker.resId));
    if (remaining.length) {
      await this.receiveAgentEvent({
        type: "sticker_annotation",
        id: randomUUID(),
        occurredAt: Date.now(),
        resIds: remaining.map((sticker) => sticker.resId),
        content: JSON.stringify(remaining),
      });
    }
  }

  /** 单群人工开关只控制该群是否允许参与，消息继续接收。 */
  async setChannelEnabled(channelId: string, enabled: boolean): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel || channel.enabled === enabled) {
      return;
    }
    channel.enabled = enabled;
    await this.syncChannelParticipation(channel);
  }

  /** 全局活动权限（睡眠 / 互动场景）统一同步到所有白名单群。 */
  async setParticipationAllowed(allowed: boolean): Promise<void> {
    this.activityAllowsParticipation = allowed;
    await Promise.all(
      [...this.channels.values()].map((channel) => this.syncChannelParticipation(channel)),
    );
  }

  private async syncChannelParticipation(channel: ChannelSession): Promise<void> {
    if (!channel.enabled || !this.activityAllowsParticipation) {
      if (this.plannerRuntime.focusedChannelId === channel.scope.channelId) {
        clearTimeout(this.wakeTimer);
      }
      const release = await this.acquireStateWrite();
      try {
        let plannerChanged = false;
        if (!channel.runtime.paused) {
          channel.runtime.paused = {
            summary: channel.replyer.summary.text,
            coveredThrough: channel.replyer.summary.coveredThrough,
          };
        }
        if (this.plannerRuntime.focusedChannelId === channel.scope.channelId) {
          this.plannerRuntime.waiting = undefined;
          // 单个群被手动关闭时释放焦点，让其他启用中的群可以继续接收注意力。
          if (!channel.enabled) {
            this.plannerRuntime.focusedChannelId = null;
            this.plannerRuntime.focusAnnouncementPending = undefined;
          }
          plannerChanged = true;
        }
        await this.commitChannel(channel, { runtime: channel.runtime });
        if (plannerChanged) {
          await this.commitPlanner({ runtime: this.plannerRuntime });
        }
      } finally {
        release();
      }
      if (!channel.enabled && this.activityAllowsParticipation) {
        this.requestRun();
      }
      return;
    }

    if (!channel.runtime.paused) {
      this.requestRun();
      return;
    }
    if (!channel.resumingTask) {
      channel.resumingTask = this.resumePausedChannel(channel);
    }
    await channel.resumingTask;
  }

  private async resumePausedChannel(channel: ChannelSession): Promise<void> {
    try {
      // 正在进行的轮次可能还在使用该群 Replyer，必须等本轮完成后再整理暂停背景。
      await this.runningTask;
      while (channel.enabled && this.activityAllowsParticipation && this.acceptingMessages) {
        await this.stateWriteQueue;
        if (!channel.enabled || !this.activityAllowsParticipation || !this.acceptingMessages) {
          return;
        }
        if (channel.runtime.paused) {
          await this.preparePausedBackground(channel);
        }
        const release = await this.acquireStateWrite();
        try {
          if (!channel.enabled || !this.activityAllowsParticipation || !this.acceptingMessages) {
            return;
          }
          // 整理期间又收到的消息也属于暂停期，处理完才能重新开放参与。
          if (
            channel.runtime.paused &&
            channel.runtime.sequence > channel.runtime.processedThrough
          ) {
            continue;
          }
          channel.runtime.paused = undefined;
          channel.runtime.notifiedThrough = undefined;
          await this.commitChannel(channel, { runtime: channel.runtime });
        } finally {
          release();
        }
        if (channel.enabled && this.activityAllowsParticipation) {
          // 必须先清除 resumingTask 再触发调度，避免 run() 同步检查 isChannelRunnable 时误判仍在恢复。
          channel.resumingTask = undefined;
          this.requestRun();
          return;
        }
      }
    } finally {
      channel.resumingTask = undefined;
    }
  }

  private async preparePausedBackground(channel: ChannelSession): Promise<void> {
    const through = channel.runtime.sequence;
    const messages = channel.history.filter(
      (message) =>
        message.sequence > channel.runtime.paused!.coveredThrough && message.sequence <= through,
    );
    const config = await load_config();
    const windowTokens = config.llm!.models!.flash!.context_window_tokens!;
    const instructions = messages.length >= 30 ? await renderPrompt("conversation.paused") : "";
    const timezone = config.app!.timezone!;
    while (messages.length >= 30 && channel.runtime.paused!.coveredThrough < through) {
      const previous = channel.runtime.paused!;
      const batch: ConversationMessage[] = [];
      let bytes = Buffer.byteLength(instructions + previous.summary, "utf8");
      for (const message of channel.history.filter(
        (item) => item.sequence > previous.coveredThrough && item.sequence <= through,
      )) {
        const size = Buffer.byteLength(renderMessage(message, timezone, this.botIds), "utf8");
        if (bytes + size >= windowTokens * 0.7) {
          break;
        }
        batch.push(message);
        bytes += size;
      }
      if (!batch.length) {
        throw new Error("暂停聊天的最小消息单位无法放入摘要窗口");
      }
      const summary = await summarizePausedBackground(
        instructions,
        previous.summary,
        batch,
        timezone,
        this.botIds,
      );
      const release = await this.acquireStateWrite();
      try {
        channel.runtime.paused = {
          summary,
          coveredThrough: batch.at(-1)!.sequence,
        };
        await this.commitChannel(channel, { runtime: channel.runtime });
      } finally {
        release();
      }
    }

    const paused = channel.runtime.paused!;
    const summaryChanged = paused.coveredThrough > channel.replyer.summary.coveredThrough;
    if (summaryChanged) {
      await channel.replyer.replacePausedSummary({
        text: paused.summary,
        coveredThrough: paused.coveredThrough,
      });
    }
    const release = await this.acquireStateWrite();
    try {
      // 只有当前焦点群恢复时直接写入 Planner 背景，避免多群同时把睡眠期记录灌进单 Planner。
      let plannerChanged = false;
      if (this.plannerRuntime.focusedChannelId === channel.scope.channelId) {
        const background = [
          ...(summaryChanged ? [paused.summary] : []),
          ...channel.history
            .filter(
              (message) =>
                message.sequence >
                  Math.max(paused.coveredThrough, channel.runtime.plannerInputThrough) &&
                message.sequence <= through,
            )
            .map((message) => renderMessage(message, timezone, this.botIds)),
        ].join("\n");
        if (background) {
          this.planner.appendBackground(
            `群「${channel.name}」（${channel.scope.channelId}）暂停期间的交流背景（仅供理解后续消息，不追补回复）：\n${background}`,
          );
          plannerChanged = true;
        }
      }
      channel.runtime.processedThrough = through;
      channel.runtime.plannerInputThrough = through;
      channel.runtime.failedThroughSequence = undefined;
      channel.runtime.notifiedThrough = undefined;
      if (this.plannerRuntime.currentRound?.channelId === channel.scope.channelId) {
        this.plannerRuntime.currentRound = undefined;
        this.plannerRuntime.waiting = undefined;
        plannerChanged = true;
      }
      this.pruneHistory(channel);
      await this.commitChannel(channel, {
        runtime: channel.runtime,
        history: channel.history,
        replyerSummary: channel.replyer.summary,
      });
      if (plannerChanged) {
        await this.commitPlanner({
          runtime: this.plannerRuntime,
          planner: this.planner.state,
        });
      }
    } finally {
      release();
    }
  }

  /** 切焦进入长时间未查看的群：超过 30 条未读时先压缩较早部分，仅留最近 15 条作活跃未读。 */
  private async prepareUnfocusedBacklog(channel: ChannelSession): Promise<string | undefined> {
    const unread = this.pendingOf(channel);
    if (unread.length < UNFOCUSED_SUMMARY_THRESHOLD) {
      return undefined;
    }
    const keepFromSequence = unread[unread.length - UNFOCUSED_KEEP_RECENT].sequence;
    const olderMessages = channel.history.filter(
      (message) =>
        message.sequence > channel.runtime.plannerInputThrough &&
        message.sequence < keepFromSequence,
    );
    if (!olderMessages.length) {
      return undefined;
    }
    const config = await load_config();
    const windowTokens = config.llm!.models!.flash!.context_window_tokens!;
    const timezone = config.app!.timezone!;
    const instructions = await renderPrompt("conversation.paused");
    let summary = channel.replyer.summary.text;
    let coveredThrough = channel.runtime.plannerInputThrough;
    const through = olderMessages.at(-1)!.sequence;
    while (coveredThrough < through) {
      const batch: ConversationMessage[] = [];
      let bytes = Buffer.byteLength(instructions + summary, "utf8");
      for (const message of olderMessages.filter((item) => item.sequence > coveredThrough)) {
        const size = Buffer.byteLength(renderMessage(message, timezone, this.botIds), "utf8");
        if (bytes + size >= windowTokens * 0.7) {
          break;
        }
        batch.push(message);
        bytes += size;
      }
      if (!batch.length) {
        throw new Error("后台未读积压的最小消息单位无法放入摘要窗口");
      }
      summary = await summarizePausedBackground(
        instructions,
        summary,
        batch,
        timezone,
        this.botIds,
      );
      coveredThrough = batch.at(-1)!.sequence;
    }
    const release = await this.acquireStateWrite();
    try {
      if (
        !this.scheduling ||
        !this.isChannelRunnable(channel) ||
        this.plannerRuntime.focusedChannelId !== channel.scope.channelId
      ) {
        return undefined;
      }
      channel.runtime.processedThrough = Math.max(
        channel.runtime.processedThrough,
        keepFromSequence - 1,
      );
      channel.runtime.plannerInputThrough = Math.max(
        channel.runtime.plannerInputThrough,
        keepFromSequence - 1,
      );
      this.pruneHistory(channel);
      await this.commitChannel(channel, {
        runtime: channel.runtime,
        history: channel.history,
      });
      return summary;
    } finally {
      release();
    }
  }

  /** 接收只等待 Redis 提交，不等待 Planner、Replyer 或 MongoDB。 */
  async receive(channelId: string, input: IncomingEvent): Promise<void> {
    if (this.persistenceError) {
      throw this.persistenceError;
    }
    if (!this.acceptingMessages) {
      return;
    }
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`收到未接入白名单的群消息：${channelId}`);
    }
    const release = await this.acquireStateWrite();
    try {
      const message: ConversationMessage = { ...input, sequence: ++channel.runtime.sequence };
      channel.history.push(message);
      if (!this.runningTask && !channel.runtime.paused) {
        channel.replyer.observe(channel.history);
      }
      this.pruneHistory(channel);
      await this.commitChannel(
        channel,
        {
          runtime: channel.runtime,
          history: channel.history,
          replyerSummary: channel.replyer.summary,
        },
        [message],
      );
      if (
        !this.scheduling ||
        !this.isChannelRunnable(channel) ||
        this.runningTask ||
        this.plannerRuntime.focusedChannelId !== channelId
      ) {
        logger.info("群聊消息已暂存", {
          channelId,
          reason: !this.scheduling
            ? "调度尚未启动或已停止"
            : !this.isChannelRunnable(channel)
              ? "该群当前暂停参与"
              : this.runningTask
                ? "当前轮次仍在执行"
                : "当前注意力在其他群聊",
          pendingCount: this.pendingOf(channel).length,
        });
      }
    } finally {
      release();
    }
    if (input.kind === "message") {
      await this.stickers.observeMessage(input.content);
    }
    this.requestRun();
  }

  /** 真实发送先写入内存和本轮快照；保存失败也不能抹去平台确认的事实。 */
  private async recordSent(
    channel: ChannelSession,
    inputs: IncomingEvent[],
    roundHistory: ConversationMessage[],
  ): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      const messages = inputs.map(
        (input): ConversationMessage => ({ ...input, sequence: ++channel.runtime.sequence }),
      );
      channel.history.push(...messages);
      roundHistory.push(...messages);
      channel.runtime.silentRounds = 0;
      channel.runtime.silenceCooldownUntil = 0;
      await this.commitChannel(
        channel,
        { runtime: channel.runtime, history: channel.history },
        messages,
      );
    } finally {
      release();
    }
  }

  /** 发送和 Skill 平台写入前等待此提交，确保中断后不重放已尝试的操作。 */
  private async beforeSend(): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      this.plannerRuntime.currentRound!.sendAttempted = true;
      await this.commitPlanner({ runtime: this.plannerRuntime });
    } finally {
      release();
    }
  }

  /** 完整模型步骤或压缩后的上下文才可提交，不保存孤立的工具调用。 */
  private async savePlannerContext(): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      await this.commitPlanner({ planner: this.planner.state });
    } finally {
      release();
    }
  }

  /** 摘要与它对应的原文裁剪必须一起提交，避免恢复后丢失未覆盖的原文。 */
  private async saveReplyerSummary(channel: ChannelSession): Promise<void> {
    const release = await this.acquireStateWrite();
    try {
      this.pruneHistory(channel);
      await this.commitChannel(channel, {
        history: channel.history,
        replyerSummary: channel.replyer.summary,
      });
    } finally {
      release();
    }
  }

  private failPersistence(error: unknown): never {
    this.persistenceError = new Error("会话 Redis 提交失败，已停止接收和调度", { cause: error });
    this.acceptingMessages = false;
    this.scheduling = false;
    clearTimeout(this.wakeTimer);
    logger.error(this.persistenceError.message, { error });
    throw this.persistenceError;
  }

  private async commitPlanner(changes: Partial<PlannerState>): Promise<void> {
    if (this.persistenceError) {
      throw this.persistenceError;
    }
    try {
      await savePlannerState(this.characterId, this.platform, changes);
    } catch (error) {
      this.failPersistence(error);
    }
  }

  private async commitChannel(
    channel: ChannelSession,
    changes: Partial<ChannelState>,
    events: ConversationMessage[] = [],
  ): Promise<void> {
    if (this.persistenceError) {
      throw this.persistenceError;
    }
    try {
      await saveChannelState(channel.scope, changes, events);
    } catch (error) {
      this.failPersistence(error);
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
    if (!this.scheduling || !this.activityAllowsParticipation) {
      return;
    }
    this.wakeRequested = true;
    if (!this.runningTask) {
      this.runningTask = this.runTask();
    }
  }

  /** 统一收口后台调度的异常，并接住任务退出时到达的新唤醒。 */
  private async runTask(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error("群会话调度失败", { error });
    } finally {
      this.runningTask = undefined;
      if (this.wakeRequested) {
        this.requestRun();
      }
    }
  }

  /** 扫描后台其他启用群聊的未读与触发状态，用于提醒当前焦点 Planner。 */
  private inspectBackgroundChannels(focusedId: string, now: number): BackgroundNotice[] {
    const notices: BackgroundNotice[] = [];
    for (const channel of this.channels.values()) {
      if (channel.scope.channelId === focusedId || !this.isChannelRunnable(channel)) {
        continue;
      }
      const pending = this.pendingOf(channel);
      if (!pending.length) {
        continue;
      }
      const latestSequence = pending.at(-1)!.sequence;
      const trigger = evaluateTrigger({
        pending,
        history: channel.history,
        selfId: this.selfId,
        names: this.names,
        botIds: this.botIds,
        nextEligibleAt: channel.runtime.silenceCooldownUntil,
        now,
      });
      const unnotified = latestSequence > (channel.runtime.notifiedThrough ?? 0);
      const directedMessage = [...pending]
        .reverse()
        .find((message) => isDirectedMessage(message, this.selfId, this.names));
      let detail = "";
      if (directedMessage) {
        if (directedMessage.kind === "poke") {
          detail = `，${directedMessage.senderName} 戳了戳你`;
        } else if (directedMessage.kind === "message") {
          const preview = visibleText(directedMessage.content).replaceAll(/\s+/g, " ").trim();
          const clipped = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
          detail = `，${directedMessage.senderName} 提到了你${clipped ? `「${clipped}」` : ""}`;
        }
      }
      notices.push({
        channel,
        latestSequence,
        shouldWake: unnotified && trigger.shouldRun,
        nextCheckAt: unnotified && trigger.shouldRecheck ? now + RECHECK_INTERVAL_MS : undefined,
        line: `- 群「${channel.name}」（channelId: ${channel.scope.channelId}）：${pending.length} 条未读${detail}`,
      });
    }
    return notices;
  }

  /** 无焦点时按内部事件来源与触发条件挑选首个聚焦群；找不到时返回最早复查时间。 */
  private selectInitialFocus(now: number): {
    channel?: ChannelSession;
    nextCheckAt?: number;
  } {
    const runnable = [...this.channels.values()].filter((channel) =>
      this.isChannelRunnable(channel),
    );
    if (!runnable.length) {
      return {};
    }
    const unconsumedEvents = (this.plannerRuntime.agentEvents ?? []).filter(
      (event) => !event.consumed,
    );
    const targetedEvent = unconsumedEvents.find(
      (event) =>
        event.channelId !== undefined &&
        runnable.some((channel) => channel.scope.channelId === event.channelId),
    );
    if (targetedEvent?.channelId) {
      return { channel: this.channels.get(targetedEvent.channelId)! };
    }

    let bestDirected: { channel: ChannelSession; earliestAt: number } | undefined;
    let bestTriggered: { channel: ChannelSession; score: number; earliestAt: number } | undefined;
    let nextCheckAt: number | undefined;
    for (const channel of runnable) {
      const pending = this.pendingOf(channel);
      if (!pending.length) {
        continue;
      }
      const trigger = evaluateTrigger({
        pending,
        history: channel.history,
        selfId: this.selfId,
        names: this.names,
        botIds: this.botIds,
        nextEligibleAt: channel.runtime.silenceCooldownUntil,
        now,
      });
      if (trigger.shouldRun) {
        const earliestAt = pending[0].timestamp;
        if (trigger.interruptsWait) {
          if (!bestDirected || earliestAt < bestDirected.earliestAt) {
            bestDirected = { channel, earliestAt };
          }
        } else if (
          !bestTriggered ||
          trigger.score > bestTriggered.score ||
          (trigger.score === bestTriggered.score && earliestAt < bestTriggered.earliestAt)
        ) {
          bestTriggered = { channel, score: trigger.score, earliestAt };
        }
      } else if (trigger.shouldRecheck) {
        const checkAt = now + RECHECK_INTERVAL_MS;
        nextCheckAt = nextCheckAt === undefined ? checkAt : Math.min(nextCheckAt, checkAt);
      }
    }
    if (bestDirected) {
      return { channel: bestDirected.channel };
    }
    if (bestTriggered) {
      return { channel: bestTriggered.channel };
    }
    if (unconsumedEvents.length) {
      return { channel: runnable[0] };
    }
    return { nextCheckAt };
  }

  private scheduleWake(nextCheckAt: number | undefined): void {
    if (this.scheduling && nextCheckAt !== undefined) {
      this.wakeTimer = setTimeout(() => this.requestRun(), Math.max(0, nextCheckAt - Date.now()));
    }
  }

  /** 状态判断与输入提交在队列中完成，释放队列后才调用模型。 */
  private async run(): Promise<void> {
    clearTimeout(this.wakeTimer);
    while (this.scheduling && this.activityAllowsParticipation && this.wakeRequested) {
      this.wakeRequested = false;

      // 若刚切入目标群且后台积压 >= 30 条，先在写入队列外完成较早消息的摘要压缩。
      let backlogSummary: string | undefined;
      const candidateFocusId = this.plannerRuntime.focusedChannelId;
      if (candidateFocusId && this.plannerRuntime.focusAnnouncementPending) {
        const candidate = this.channels.get(candidateFocusId);
        if (candidate && this.isChannelRunnable(candidate)) {
          backlogSummary = await this.prepareUnfocusedBacklog(candidate);
        }
      }

      let focused: ChannelSession | undefined;
      let roundInput:
        | {
            messages: ConversationMessage[];
            history: ConversationMessage[];
            throughSequence: number;
            agentEvents: PlannerAgentEvent[];
            otherChatsSummary?: string;
            triggeredOnlyByBackground: boolean;
          }
        | undefined;

      const release = await this.acquireStateWrite();
      try {
        if (!this.scheduling || !this.activityAllowsParticipation) {
          return;
        }
        const now = Date.now();
        // 1. 优先恢复未完成轮次或确认当前焦点群。
        const currentRound = this.plannerRuntime.currentRound;
        if (currentRound) {
          const roundChannel = this.channels.get(currentRound.channelId);
          if (roundChannel && this.isChannelRunnable(roundChannel)) {
            this.plannerRuntime.focusedChannelId = roundChannel.scope.channelId;
            focused = roundChannel;
          } else {
            this.plannerRuntime.currentRound = undefined;
            this.plannerRuntime.waiting = undefined;
          }
        }
        if (!focused && this.plannerRuntime.focusedChannelId !== null) {
          const current = this.channels.get(this.plannerRuntime.focusedChannelId);
          if (current && this.isChannelRunnable(current)) {
            focused = current;
          } else if (current && current.enabled && this.activityAllowsParticipation) {
            // 原焦点群已启用且正在从暂停恢复（如刚睡醒正在整理背景），等待其恢复完成，不趁机抢焦。
            return;
          }
        }
        if (!focused) {
          const selection = this.selectInitialFocus(now);
          if (!selection.channel) {
            this.scheduleWake(selection.nextCheckAt);
            return;
          }
          focused = selection.channel;
          this.plannerRuntime.focusedChannelId = focused.scope.channelId;
          this.plannerRuntime.focusAnnouncementPending = true;
          await this.commitPlanner({ runtime: this.plannerRuntime });
          // 首次落焦且积压较多时，先退回循环顶部完成较早未读摘要，再进入本轮。
          if (this.pendingOf(focused).length >= UNFOCUSED_SUMMARY_THRESHOLD) {
            this.wakeRequested = true;
            continue;
          }
        }

        const activeChannel = focused;
        // 2. 分别评估当前焦点群和后台其他群聊的触发条件。
        const pending = this.pendingOf(activeChannel);
        const focusedCurrentRound =
          this.plannerRuntime.currentRound?.channelId === activeChannel.scope.channelId
            ? this.plannerRuntime.currentRound
            : undefined;
        const next = getNextRound({
          now,
          pending,
          history: activeChannel.history,
          channelRuntime: activeChannel.runtime,
          currentRound: focusedCurrentRound,
          waiting: this.plannerRuntime.waiting,
          agentEvents: this.plannerRuntime.agentEvents ?? [],
          selfId: this.selfId,
          names: this.names,
          botIds: this.botIds,
        });
        const backgroundNotices = this.inspectBackgroundChannels(
          activeChannel.scope.channelId,
          now,
        );
        const hasBackgroundWake =
          !this.plannerRuntime.waiting && backgroundNotices.some((notice) => notice.shouldWake);
        const switchedIn = this.plannerRuntime.focusAnnouncementPending === true;

        if (next.waitedSeconds !== undefined) {
          this.plannerRuntime.waiting = undefined;
        }
        if (!next.input && !switchedIn && !hasBackgroundWake) {
          if (next.waitedSeconds !== undefined) {
            await this.commitPlanner({ runtime: this.plannerRuntime });
          }
          const checkTimes = [
            next.nextCheckAt,
            ...backgroundNotices.map((notice) => notice.nextCheckAt),
          ].filter((time): time is number => time !== undefined);
          this.scheduleWake(checkTimes.length ? Math.min(...checkTimes) : undefined);
          return;
        }

        // 3. 组装本轮输入并提交（切群边界、焦点群未读、内部事件、后台群通知标记）。
        const messages = next.input ? next.input.messages : pending;
        const throughSequence = next.input
          ? next.input.throughSequence
          : (messages.at(-1)?.sequence ?? activeChannel.runtime.processedThrough);
        const roundHistory = next.input
          ? next.input.history
          : activeChannel.history.filter(
              (message) => message.sequence <= throughSequence || message.isSelf,
            );
        const agentEvents = next.input ? next.input.agentEvents : [];
        const triggeredOnlyByBackground = !next.input && !switchedIn && hasBackgroundWake;

        const userMessages = messages.filter((message) => !this.botIds.includes(message.senderId));
        if ((userMessages.length || messages.length) >= 6) {
          activeChannel.runtime.silenceCooldownUntil = 0;
        }
        this.plannerRuntime.currentRound = {
          channelId: activeChannel.scope.channelId,
          throughSequence,
          sendAttempted: false,
        };

        let plannerChanged = false;
        if (switchedIn) {
          const switchLines = [
            `当前聚焦群聊已切换为「${activeChannel.name}」（channelId: ${activeChannel.scope.channelId}）。后续消息、工具操作与回复均针对本群。`,
          ];
          if (backlogSummary) {
            switchLines.push(
              `未关注本群期间的较早消息背景（仅作参考，以下紧接最新未读消息）：\n${backlogSummary}`,
            );
          }
          this.planner.appendBackground(switchLines.join("\n\n"));
          this.plannerRuntime.focusAnnouncementPending = false;
          activeChannel.runtime.notifiedThrough = undefined;
          plannerChanged = true;
        }

        const newMessages = messages.filter(
          (message) => message.sequence > activeChannel.runtime.plannerInputThrough,
        );
        if (newMessages.length > 0 || next.waitedSeconds !== undefined) {
          this.planner.appendInput(newMessages, next.waitedSeconds);
          plannerChanged = true;
        }

        if (agentEvents.length) {
          const timezone = (await load_config()).app!.timezone!;
          for (const event of agentEvents) {
            const sourceChannel = event.channelId ? this.channels.get(event.channelId) : undefined;
            this.planner.appendBackground(
              [
                `${event.type === "sticker_annotation" ? "QQ 收藏待标注事件" : `来自主 loop 的${event.type === "share" ? "分享意图" : "交流反馈"}`}（事件 ID：${event.id}）`,
                `发生时间：${formatLlmDateTime(event.occurredAt, timezone)}`,
                ...(sourceChannel
                  ? [
                      `关联群聊：「${sourceChannel.name}」（channelId: ${sourceChannel.scope.channelId}）`,
                    ]
                  : []),
                ...(event.type === "result" ? [`关联事件 ID：${event.relatedEventId}`] : []),
                event.content,
              ].join("\n"),
            );
            this.plannerRuntime.agentEvents!.find(
              (received) => received.id === event.id,
            )!.consumed = true;
          }
          plannerChanged = true;
        }

        activeChannel.runtime.plannerInputThrough = throughSequence;
        const notifiedChannels: ChannelSession[] = [];
        for (const notice of backgroundNotices) {
          if (notice.shouldWake) {
            notice.channel.runtime.notifiedThrough = notice.latestSequence;
            notifiedChannels.push(notice.channel);
          }
        }
        const otherChatsSummary = backgroundNotices.length
          ? backgroundNotices.map((notice) => notice.line).join("\n")
          : undefined;

        await this.commitPlanner({
          runtime: this.plannerRuntime,
          ...(plannerChanged && { planner: this.planner.state }),
        });
        await Promise.all([
          this.commitChannel(activeChannel, { runtime: activeChannel.runtime }),
          ...notifiedChannels.map((channel) =>
            this.commitChannel(channel, { runtime: channel.runtime }),
          ),
        ]);

        roundInput = {
          messages,
          history: roundHistory,
          throughSequence,
          agentEvents,
          otherChatsSummary,
          triggeredOnlyByBackground,
        };
      } finally {
        release();
      }

      const execution = await this.runRound(focused, roundInput);

      const finishWrite = await this.acquireStateWrite();
      try {
        if (this.persistenceError) {
          throw this.persistenceError;
        }
        if (
          !execution.failed ||
          execution.sendAttempted ||
          execution.waitSeconds !== undefined ||
          execution.switchChannelId !== undefined
        ) {
          focused.runtime.processedThrough = roundInput.throughSequence;
          focused.runtime.failedThroughSequence = undefined;
        } else {
          focused.runtime.failedThroughSequence = roundInput.throughSequence;
        }

        let switchedTarget: ChannelSession | undefined;
        if (execution.switchChannelId !== undefined) {
          const target = this.channels.get(execution.switchChannelId);
          if (target && this.isChannelRunnable(target)) {
            this.plannerRuntime.focusedChannelId = target.scope.channelId;
            this.plannerRuntime.focusAnnouncementPending = true;
            this.plannerRuntime.waiting = undefined;
            target.runtime.notifiedThrough = undefined;
            switchedTarget = target;
          }
        } else if (execution.waitSeconds !== undefined && this.isChannelRunnable(focused)) {
          const startedAt = Date.now();
          this.plannerRuntime.waiting = {
            startedAt,
            until: startedAt + execution.waitSeconds * 1000,
          };
          focused.runtime.silentRounds = 0;
          focused.runtime.silenceCooldownUntil = 0;
        } else if (
          !execution.failed &&
          !execution.sendAttempted &&
          !roundInput.triggeredOnlyByBackground
        ) {
          focused.runtime.silentRounds += 1;
          if (focused.runtime.silentRounds >= 2) {
            focused.runtime.silenceCooldownUntil =
              Date.now() +
              BACKOFF_DELAYS_MS[
                Math.min(focused.runtime.silentRounds - 2, BACKOFF_DELAYS_MS.length - 1)
              ];
          }
        }

        this.plannerRuntime.currentRound = undefined;
        if (!focused.runtime.paused) {
          focused.replyer.observe(focused.history);
        } else if (focused.replyer.summary.coveredThrough > focused.runtime.paused.coveredThrough) {
          // 暂停前开始的轮次仍可能压缩 Replyer，暂停背景必须沿用新的摘要边界。
          focused.runtime.paused = {
            summary: focused.replyer.summary.text,
            coveredThrough: focused.replyer.summary.coveredThrough,
          };
        }
        this.pruneHistory(focused);

        await this.commitPlanner({ runtime: this.plannerRuntime });
        await Promise.all([
          this.commitChannel(focused, {
            runtime: focused.runtime,
            history: focused.history,
            replyerSummary: focused.replyer.summary,
          }),
          ...(switchedTarget
            ? [this.commitChannel(switchedTarget, { runtime: switchedTarget.runtime })]
            : []),
        ]);

        logger.info("Planner 轮次结束", {
          channelId: focused.scope.channelId,
          sendAttempted: execution.sendAttempted,
          failed: execution.failed,
          waitSeconds: execution.waitSeconds ?? null,
          switchedTo: switchedTarget?.scope.channelId ?? null,
          silentRounds: focused.runtime.silentRounds,
          cooldownSeconds: Math.max(
            0,
            Math.ceil((focused.runtime.silenceCooldownUntil - Date.now()) / 1000),
          ),
          pendingCount: this.pendingOf(focused).length,
        });

        const currentFocused = this.plannerRuntime.focusedChannelId
          ? this.channels.get(this.plannerRuntime.focusedChannelId)
          : undefined;
        const hasUnnotifiedBackground = currentFocused
          ? this.inspectBackgroundChannels(currentFocused.scope.channelId, Date.now()).some(
              (notice) => notice.shouldWake || notice.nextCheckAt !== undefined,
            )
          : false;
        this.wakeRequested =
          switchedTarget !== undefined ||
          (currentFocused !== undefined && this.pendingOf(currentFocused).length > 0) ||
          this.plannerRuntime.waiting !== undefined ||
          (this.plannerRuntime.agentEvents ?? []).some((event) => !event.consumed) ||
          hasUnnotifiedBackground;
      } finally {
        finishWrite();
      }
    }
  }

  /** 工具通过具名回调提交副作用；模型失败不抹去已确认的发送结果。 */
  private async runRound(
    focused: ChannelSession,
    input: {
      messages: ConversationMessage[];
      history: ConversationMessage[];
      throughSequence: number;
      agentEvents: PlannerAgentEvent[];
      otherChatsSummary?: string;
    },
  ): Promise<ConversationToolContext> {
    const execution: ConversationToolContext = {
      connection: this.connection,
      groupName: focused.name,
      stickers: this.stickers,
      annotationResIds: (this.plannerRuntime.agentEvents ?? []).flatMap((event) =>
        event.type === "sticker_annotation" && event.consumed ? event.resIds : [],
      ),
      replyer: focused.replyer,
      history: input.history,
      historyThrough: input.history.at(-1)?.sequence ?? 0,
      // 只认本轮消息中的 @ 和引用回复，不包含昵称呼叫、戳一戳或旧历史。
      receivedMentionOrReply: input.messages.some(
        (message) => message.kind === "message" && isDirectedMessage(message, this.selfId, []),
      ),
      otherChatsSummary: input.otherChatsSummary,
      canSwitchTo: (channelId) => {
        if (channelId === focused.scope.channelId) {
          return { ok: false, reason: "你当前已经在这个群聊里了，不需要切换。" };
        }
        const target = this.channels.get(channelId);
        if (!target) {
          return { ok: false, reason: `群 ${channelId} 不在已接入的白名单中。` };
        }
        if (!this.isChannelRunnable(target)) {
          return {
            ok: false,
            reason: `群「${target.name}」（${channelId}）当前处于暂停或关闭状态。`,
          };
        }
        return { ok: true, name: target.name };
      },
      beforeSend: async () => await this.beforeSend(),
      recordSent: async (events) => await this.recordSent(focused, events, input.history),
      saveReplyerSummary: async () => await this.saveReplyerSummary(focused),
      sendAttempted: false,
      failed: false,
      readCharacter: async () => await this.character.readConversationContext(),
      notifyCharacter: async (description, messageIds, relatedEventId) => {
        if (
          relatedEventId &&
          !this.plannerRuntime.agentEvents?.some(
            (event) =>
              event.type !== "sticker_annotation" && event.id === relatedEventId && event.consumed,
          )
        ) {
          return "未投递：关联事件不在已接收的主 loop 输入中，请使用可见的事件 ID。";
        }
        return await this.character.notifyFromConversation(
          focused.scope,
          description,
          messageIds,
          relatedEventId,
        );
      },
    };
    try {
      logger.info("Planner 开始运行", {
        channelId: focused.scope.channelId,
        groupName: focused.name,
        messageCount: input.messages.length,
        agentEventCount: input.agentEvents.length,
        hasOtherChatsSummary: input.otherChatsSummary !== undefined,
      });
      await this.planner.run(focused.scope, execution, async () => await this.savePlannerContext());
    } catch (error) {
      execution.failed = true;
      logger.error("聊天工具循环失败", { channelId: focused.scope.channelId, error });
    }
    return execution;
  }

  private pruneHistory(channel: ChannelSession): void {
    const recentSince = Date.now() - 300_000;
    channel.history = channel.history.filter(
      (message) =>
        (!message.isSelf && message.sequence > channel.runtime.processedThrough) ||
        message.sequence > channel.replyer.summary.coveredThrough ||
        message.timestamp >= recentSince,
    );
  }

  /** 停止新输入与调度，等待在途轮次和压缩，最终快照仍必须等待 Redis 确认。 */
  async stop(): Promise<void> {
    this.acceptingMessages = false;
    this.scheduling = false;
    clearTimeout(this.wakeTimer);
    await Promise.all([...this.channels.values()].map((channel) => channel.resumingTask));
    await this.runningTask;
    await this.stateWriteQueue;
    await Promise.all([
      this.planner.stop(),
      ...[...this.channels.values()].map((channel) => channel.replyer.stop()),
    ]);
    for (const channel of this.channels.values()) {
      this.pruneHistory(channel);
    }
    await this.commitPlanner({
      runtime: this.plannerRuntime,
      planner: this.planner.state,
    });
    await Promise.all(
      [...this.channels.values()].map((channel) =>
        this.commitChannel(channel, {
          runtime: channel.runtime,
          history: channel.history,
          replyerSummary: channel.replyer.summary,
        }),
      ),
    );
  }
}
