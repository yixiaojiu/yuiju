import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { strongModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText } from "ai";
import { formatLlmPlatform } from "../conversation/platform";
import { recordExperience } from "../memory/experiences";
import { formatPlans, nextPlanAttention, readPlans, signalPlansDue } from "../plan/plan";
import { formatWorldEvent } from "../world/tools";
import { agentMessages, prepareAgentContext } from "./context";
import {
  type CharacterEvent,
  readActivityWait,
  readCharacterEvents,
  signalActivityDue,
} from "./events";
import {
  type AgentState,
  finishAgentRound,
  loadAgentState,
  readAgentActions,
  saveAgentAction,
  saveAgentState,
} from "./storage";
import {
  type AgentToolContext,
  agentToolDescription,
  agentTools,
  createAgentTools,
  executeAgentAction,
} from "./tools";

/** 一个角色的日常决策执行器；只串行自己的轮次，不占用世界推进或其他角色。 */
export class MainAgentLoop {
  private readonly stopping = new AbortController();
  private instructions = "";
  private windowTokens = 0;
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
      renderPrompt("agentLoop.main"),
      renderPrompt(`agentLoop.main.${this.execution.characterId}`),
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

  /** 失败时保留原轮次，十秒后读取 Redis 确认提交结果再接续，不重建请求标识。 */
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
        const recovering = state.round !== null;
        if (!state.round) {
          const batch = await readCharacterEvents(characterId);
          if (!batch.events.length) {
            continue;
          }
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
              state.round = { id: randomUUID(), ...batch };
              await finishAgentRound(characterId, state);
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
          state.round = { id: randomUUID(), ...batch };
          await saveAgentState(characterId, state);
        }

        await this.runRound(state, recovering);
        await finishAgentRound(characterId, state);

        // 再读一次，接住本轮执行期间保存的新事件。
        this.wakeRequested = true;
      }
    } catch (error) {
      failed = true;
      if (this.active) {
        logger.error("角色主 loop 中断，保留当前进度等待接续", { error });
      }
    } finally {
      this.task = undefined;
      if (this.active) {
        if (failed) {
          this.timer = setTimeout(() => this.wake(), 10_000);
        } else if (this.wakeRequested) {
          this.wake();
        } else {
          await this.scheduleNextAttention();
        }
      }
    }
  }

  /** SDK 管理整轮工具调用；中间上下文只在内存更新，成功结束后由外层统一提交。 */
  private async runRound(state: AgentState, recovering: boolean): Promise<void> {
    const { characterId } = this.execution;
    const round = state.round!;
    if (recovering) {
      const actions = await readAgentActions(characterId, round.id);
      for (const [index, action] of actions.entries()) {
        this.stopping.signal.throwIfAborted();
        if (action.result === undefined) {
          action.result = await executeAgentAction(this.execution, action, true);
          await saveAgentAction(characterId, round.id, index, action);
        }
      }
      // 不恢复丢失的思考过程；先提供实际操作记录，模型按需查询现状再继续决策。
      const recovery = await renderPrompt("agentLoop.recovery", {
        actions:
          actions
            .map(
              (action) =>
                `${formatLlmDateTime(action.createdAt, this.timezone)} ${action.name} ${JSON.stringify(action.input)}\n结果：${action.result}`,
            )
            .join("\n\n") || "没有已记录的操作。",
      });
      // 恢复操作记录后统一查询一次；旧行动回执不直接覆盖当前活动与聊天权限。
      const syncFailure = await this.execution.syncWorldActivity();
      let input = `${recovery}\n\n当前时间：${formatLlmDateTime(Date.now(), this.timezone)}`;
      if (syncFailure !== null) {
        input += `\n\n${syncFailure}`;
      }
      state.context.units.push([{ role: "user", content: input }]);
    }

    // 工具持久化失败必须终止 SDK，不能被转换为 tool-error 后继续产生新的副作用。
    const failed = new AbortController();
    const signal = AbortSignal.any([this.stopping.signal, failed.signal]);
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
        state.context = await prepareAgentContext(
          state.context,
          this.instructions,
          agentTools,
          agentToolDescription,
          this.windowTokens,
          signal,
        );
        return { messages: agentMessages(state.context, this.instructions) };
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
      onStepEnd: ({ response, finishReason }) => {
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
      } else if (event.type === "activity_due") {
        lines.push(
          `活动 ${event.activityId} 已超过预计时长的 1.5 倍，尚未确认结束，需要了解实际状态。`,
        );
      } else if (event.type === "plan_attention") {
        const plan = (await readPlans(characterId)).find((item) => item.id === event.planId);
        if (
          plan?.revision === event.revision &&
          (plan.status === "pending" || plan.status === "in_progress")
        ) {
          lines.push(`这项计划到了关注时间：${await formatPlans([plan])}`);
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
      if (this.active) {
        this.timer = setTimeout(() => this.wake(), 10_000);
      }
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.stopping.abort();
    await this.task;
  }
}
