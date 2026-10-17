import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import {
  type InputTokenUsage,
  measureInputBytes,
  readInputTokenUsage,
} from "@yuiju/shared/llm/context-usage";
import { strongModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import { generateText } from "ai";
import { formatLlmPlatform } from "../conversation/platform";
import { recordExperience } from "../memory/experiences";
import { formatPlans, nextPlanAttention, signalPlansDue } from "../plan/plan";
import { readPlans } from "../plan/storage";
import { formatWorldEvent } from "../world/tools";
import { agentMessages, prepareAgentContext } from "./context";
import {
  type CharacterEvent,
  readActivityWait,
  readCharacterEvents,
  signalActivityDue,
} from "./events";
import { type AgentState, finishAgentRound, loadAgentState, saveAgentState } from "./storage";
import { type AgentToolContext, agentToolDescription, agentTools, createAgentTools } from "./tools";

/** 一个角色的日常决策执行器；只串行自己的轮次，不占用世界推进或其他角色。 */
export class MainAgentLoop {
  private readonly stopping = new AbortController();
  private instructions = "";
  private windowTokens = 0;
  /** 正常模型步骤的输入用量，不跨重启保存，也不累计输出或压缩请求的消耗。 */
  private inputUsage: InputTokenUsage | undefined;
  private timezone = "";
  private active = false;
  /** 只表示待检查 inbox；事件正文与轮次进度以 Redis 为准。 */
  private wakeRequested = false;
  private task: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly execution: AgentToolContext) {}

  async initialize(): Promise<void> {
    const config = await load_config();
    const windowTokens = config.llm?.models?.strong?.context_window_tokens;
    if (!windowTokens) {
      throw new Error("主 loop 需要配置 strong.context_window_tokens");
    }
    this.windowTokens = windowTokens;
    this.timezone = config.app!.timezone!;
    const [persona, rules, characterPrompt] = await Promise.all([
      renderPrompt(`character.persona.${this.execution.characterId}`),
      renderPrompt("agent_loop.main"),
      renderPrompt(`agent_loop.main.${this.execution.characterId}`),
    ]);
    this.instructions = `${persona}\n\n${rules}\n\n${characterPrompt}`;
  }

  start(): void {
    this.active = true;
    this.wake();
  }

  /** 接收方保存完事件后调用；不等待模型，也不把新输入插进正在执行的轮次。 */
  wake(): void {
    this.wakeRequested = true;
    if (this.active && !this.task) {
      clearTimeout(this.timer);
      this.task = this.run();
    }
  }

  /** 先记录本批输入；失败结束本轮，只有新事件或正常日程才能再次唤醒。 */
  private async run(): Promise<void> {
    let failed = false;
    try {
      while (this.active && this.wakeRequested) {
        this.wakeRequested = false;
        const characterId = this.execution.characterId;
        await signalActivityDue(characterId, Date.now());
        await signalPlansDue(characterId, Date.now());
        const state = (await loadAgentState(characterId)) ?? {
          context: { summary: "", units: [] },
          round: null,
        };
        if (state.round) {
          // 中断的旧轮次不重放，避免重复调用模型或再次执行已发生的操作。
          await finishAgentRound(characterId, state);
          logger.warn("已结束中断的主 agent 轮次，不再重试");
          this.wakeRequested = true;
          continue;
        }
        const batch = await readCharacterEvents(characterId);
        if (!batch.events.length) {
          continue;
        }
        state.round = { id: randomUUID(), ...batch };
        // 先记录本批边界；失败会消费本批，进程中断后也只清理、不重放。
        await saveAgentState(characterId, state);
        try {
          const hasIdleReminder = batch.events.some(
            (event) => event.type === "world" && event.event.type === "idle_reminder",
          );
          if (hasIdleReminder) {
            // 处理前确认活动仍相同；离线积攒的多次提醒只保留本批最新的一条。
            const current = await this.execution.world.inspect({ type: "current" });
            if (!current.ok) {
              throw new Error(`无法确认空闲提醒对应的活动：${current.message}`);
            }
            if (current.value.type === "current") {
              const activity = current.value.activity;
              await this.execution.observeActivity(activity);
              const latestReminder = [...batch.events]
                .reverse()
                .find(
                  (event) =>
                    event.type === "world" &&
                    event.event.type === "idle_reminder" &&
                    activity?.actionId === "空闲发呆" &&
                    event.event.activity?.activityId === activity.activityId,
                );
              batch.events = batch.events.filter(
                (event) =>
                  event.type !== "world" ||
                  event.event.type !== "idle_reminder" ||
                  event === latestReminder,
              );
            }
            if (!batch.events.length) {
              // 只消费过期提醒，不向上下文追加空输入，也不调用模型。
              this.wakeRequested = true;
              continue;
            }
          }
          let input = await this.describeInput(batch.events);
          // 活动相关输入才同步现状，不能将迟到的事件快照当作当前活动。
          if (
            !hasIdleReminder &&
            batch.events.some(
              (event) =>
                event.type === "connected" ||
                event.type === "activity_due" ||
                (event.type === "world" &&
                  (event.event.type === "activity_started" ||
                    event.event.type === "activity_completed")),
            )
          ) {
            const syncFailure = await this.execution.syncWorldActivity();
            if (syncFailure !== null) {
              input += `\n\n${syncFailure}`;
            }
          }
          state.context.units.push([{ role: "user", content: input }]);
          await this.runRound(state);
        } catch (error) {
          if (this.active) {
            logger.error("主 agent 本轮执行失败，结束本批，不再重试", { error });
          }
        } finally {
          // 保存完整步骤的上下文，并清理本轮工具操作记录；不重复执行副作用。
          await finishAgentRound(characterId, state);
        }

        // 再读一次，接住本轮执行期间保存的新事件。
        this.wakeRequested = true;
      }
    } catch (error) {
      failed = true;
      if (this.active) {
        logger.error("主 agent 状态读写失败，停止本次调度", { error });
      }
    } finally {
      this.task = undefined;
      if (this.active) {
        if (failed) {
          this.wakeRequested = false;
        } else if (this.wakeRequested) {
          this.wake();
        } else {
          await this.scheduleNextAttention();
        }
      }
    }
  }

  /** SDK 管理整轮工具调用；完整步骤在内存更新，结束本轮时由外层统一提交。 */
  private async runRound(state: AgentState): Promise<void> {
    const round = state.round!;

    // 工具持久化失败必须终止 SDK，不能被转换为 tool-error 后继续产生新的副作用。
    const failed = new AbortController();
    const signal = AbortSignal.any([this.stopping.signal, failed.signal]);
    let requestBytes: number;
    const result = await generateText({
      model: strongModel,
      tools: createAgentTools(this.execution, round.id, signal, (error) => failed.abort(error)),
      messages: agentMessages(state.context, this.instructions),
      allowSystemInMessages: true,
      maxRetries: 0,
      abortSignal: signal,
      // 覆盖 SDK 默认的一步限制；没有工具调用时 SDK 自然结束，不另设固定步数。
      stopWhen: () => signal.aborted,
      prepareStep: async () => {
        signal.throwIfAborted();
        const context = await prepareAgentContext(
          state.context,
          this.instructions,
          agentTools,
          agentToolDescription,
          this.windowTokens,
          signal,
          this.execution.characterId,
          this.inputUsage,
        );
        if (context !== state.context) {
          this.inputUsage = undefined;
        }
        state.context = context;
        const messages = agentMessages(context, this.instructions);
        requestBytes = measureInputBytes(messages, agentToolDescription);
        return { messages };
      },
      onToolExecutionStart: ({ toolCall }) => {
        logger.info("主 agent 调用工具", {
          tool: toolCall.toolName,
          input: Object.fromEntries(
            Object.entries(toolCall.input as Record<string, unknown>)
              .filter(([key]) => key === "actionId" || !/(?:^id$|Id$|Ids$|_id$|-id$)/.test(key))
              .map(([key, value]) => [key === "actionId" ? "action" : key, value]),
          ),
        });
      },
      onToolExecutionEnd: ({ toolCall, toolOutput, toolExecutionMs }) => {
        if (toolOutput.type === "tool-error") {
          logger.error("主 agent 工具执行异常", {
            tool: toolCall.toolName,
            durationMs: toolExecutionMs,
            error: toolOutput.error,
          });
        }
      },
      onStepEnd: ({ response, finishReason, usage }) => {
        this.inputUsage = readInputTokenUsage(requestBytes, usage);
        if (finishReason !== "stop" && finishReason !== "tool-calls") {
          // 生命周期通知会吞掉回调异常，通过 abort 阻止下一步并在返回后再次检查。
          failed.abort(new Error(`主 loop 模型步骤未完整结束：${finishReason}`));
          return;
        }
        // 这是 SDK 的单步结果，不是已废弃的 GenerateTextResult.response。
        state.context.units.push(response.messages);
      },
    });
    signal.throwIfAborted();
    if (result.finishReason !== "stop") {
      throw new Error(`主 loop 本轮未正常结束：${result.finishReason}`);
    }
  }

  private async describeInput(events: CharacterEvent[]): Promise<string> {
    const { characterId } = this.execution;
    const lines = [`当前时间：${formatLlmDateTime(Date.now(), this.timezone)}`];
    for (const event of events) {
      if (event.type === "world") {
        const content = await formatWorldEvent(event.event);
        lines.push(content);
        // 行动回执与开始通知仍参与决策；经历只在结算完成后记录一次。
        if (event.event.type === "activity_completed" || event.event.type === "weather_changed") {
          await recordExperience(characterId, {
            id: event.id,
            occurredAt: event.occurredAt,
            source: "world",
            content,
            ...(event.event.type === "activity_completed" && { activity: event.event.activity! }),
            position: event.event.position,
            people: [],
          });
        }
      } else if (event.type === "connected") {
        lines.push("世界连接已建立，需要了解现状时可以查询。");
      } else if (event.type === "emotion_result") {
        lines.push(
          `感受处理结果（${formatLlmDateTime(event.occurredAt, this.timezone)}，提交 ID：${event.result.requestIds.join("、")}）：\n${event.result.description}`,
        );
      } else if (event.type === "activity_due") {
        lines.push(
          `活动 ${event.activityId} 已超过预计时长的 1.5 倍，尚未确认结束，需要了解实际状态。`,
        );
      } else if (event.type === "plan_attention" || event.type === "plan_review") {
        const plan = (await readPlans(characterId)).find((item) => item.id === event.planId);
        if (
          plan?.revision === event.revision &&
          (plan.status === "pending" || plan.status === "in_progress")
        ) {
          lines.push(
            `${event.type === "plan_review" ? "这项计划已过计划日期或长期未更新，需要确认后续安排" : "这项计划到了关注时间"}：${await formatPlans([plan])}`,
          );
        }
      } else {
        lines.push(
          [
            `来自 ${formatLlmPlatform(event.scope.platform)} 群 ${event.scope.channelId} 的交流（事件 ID：${event.id}）`,
            ...(event.relatedEventId ? [`关联事件 ID：${event.relatedEventId}`] : []),
            event.description,
            ...(event.messageIds.length ? [`来源消息：${event.messageIds.join("、")}`] : []),
          ].join("\n"),
        );
      }
    }
    return lines.join("\n\n");
  }

  /** 只有活动和计划有截止时间；空闲时不设置循环唤醒。 */
  private async scheduleNextAttention(): Promise<void> {
    try {
      const [activity, planAt] = await Promise.all([
        readActivityWait(this.execution.characterId),
        nextPlanAttention(this.execution.characterId),
      ]);
      const times = [activity?.checkAt, planAt].filter((time): time is number => time != null);
      if (this.active && !this.task && times.length) {
        // Node timer 最大约 24 天；远期安排分段等待，但到期前不执行模型。
        this.timer = setTimeout(
          () => this.wake(),
          Math.min(2_147_483_647, Math.max(0, Math.min(...times) - Date.now())),
        );
      }
    } catch (error) {
      logger.error("恢复角色关注时间失败", { error });
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.stopping.abort();
    await this.task;
  }
}
