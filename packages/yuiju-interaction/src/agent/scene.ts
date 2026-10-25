import { EventEmitter, once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ExtensionContext,
  SceneExecution,
  SceneInstance,
  SceneResult,
} from "@yuiju/shared/extension/agent";
import {
  estimateInputTokens,
  type InputTokenUsage,
  readInputTokenUsage,
} from "@yuiju/shared/llm/context-usage";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import {
  asSchema,
  generateText,
  type InferToolOutput,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from "ai";
import { readCharacterConfig, readInteractionModel } from "../config.ts";
import { readLive2DExpressions } from "../live2d.ts";
import { scenePresetPrompts } from "../prompts.ts";
import {
  type AgentActivity,
  builtInActions,
  type InputEvent,
  type OptionalToolName,
  optionalToolNames,
} from "../protocol.ts";
import { InteractionConnection } from "./connection.ts";
import { createInteractionTools, type ObservationEvent, type RoundDecision } from "./tools.ts";

/** 一次互动的状态只活在当前场景实例中，退出后不续跑旧操作。 */
export class InteractionScene implements SceneInstance {
  private log!: typeof logger;
  private simulateSpeech = false;
  private connection!: InteractionConnection;
  private model!: LanguageModel;
  private windowTokens!: number;
  private inputUsage?: InputTokenUsage;
  private compressionPrompt = "";
  private readonly compressionController = new AbortController();
  private compressionTask?: Promise<void>;
  /** 后台只生成摘要；count 是快照覆盖的历史前缀长度，后续追加的交互不受影响。 */
  private compressed?: { summary: string; count: number };
  /** 输入在当前轮次结束后成批处理；语音分句反馈只记录，不单独触发模型。 */
  private pendingEvents: (InputEvent | ObservationEvent)[] = [];
  private readonly inputReady = new EventEmitter();
  private round?: AbortController;
  private instructions = "";
  private enabledTools!: OptionalToolName[];
  private history: ModelMessage[][] = [];
  private summary = "";
  private speechFeedback: Extract<InputEvent, { status: "speech" }>[] = [];
  private performances = new Map<string, string>();
  private waiting?: AbortController;
  private paused = false;
  private ending = false;
  private roundNumber = 0;

  constructor(private readonly context: ExtensionContext) {}

  private publishActivity(state: AgentActivity["state"], detail?: string, until?: number) {
    this.log.info("互动运行状态", { round: this.roundNumber, state, detail, until });
    this.connection.notify({
      type: "agent_activity",
      model: typeof this.model === "string" ? this.model : this.model.modelId,
      state,
      at: Date.now(),
      round: this.roundNumber,
      detail,
      until,
    });
  }

  async waitForEntry(context: string | undefined, execution: SceneExecution) {
    this.log = logger.child({
      extension: "yuiju-interaction",
      characterId: this.context.character.id,
      sessionId: execution.sessionId,
    });
    this.log.info("互动等待进入");
    const config = await readCharacterConfig(this.context.character.id);
    const { model, windowTokens } = await readInteractionModel();
    this.model = model;
    this.windowTokens = windowTokens;
    this.compressionPrompt = await renderPrompt("extension.yuiju_interaction.compression");
    const expressions = await readLive2DExpressions(config.live2d);
    execution.signal.throwIfAborted();
    this.connection = new InteractionConnection(
      config.connection,
      (event) => this.receive(event),
      this.log,
    );
    const [persona, scenePrompt, characterPrompt, scenePresets] = await Promise.all([
      renderPrompt(`character.persona.${this.context.character.id}`),
      renderPrompt("extension.yuiju_interaction.scene", {
        expressions: Object.keys(expressions)
          .map((name) => `【${name}】`)
          .join("、"),
        actions: builtInActions.map((name) => `【${name}】`).join("、"),
      }),
      renderPrompt(`character.interaction.${this.context.character.id}`),
      Promise.all(
        scenePresetPrompts.map(async (preset) => ({
          key: preset.key,
          name: preset.description,
          content: await renderPrompt(preset.key),
        })),
      ),
    ]);
    execution.signal.throwIfAborted();
    const entry = await this.connection.waitForEntry(
      {
        persona,
        scenePrompt,
        sceneContent: "",
        scenePresets,
        characterPrompt,
        context: context ?? "",
        enabledTools: [...optionalToolNames],
        simulateSpeech: true,
      },
      execution.signal,
      execution.ready,
    );
    // 用户确认后才组装本次输入；不修改全局提示词和角色原有上下文。
    this.instructions = [persona, entry.scenePrompt, entry.sceneContent, characterPrompt].join(
      "\n\n",
    );
    this.enabledTools = entry.enabledTools;
    this.simulateSpeech = entry.simulateSpeech;
    this.log.info("互动进入场景", {
      enabledTools: this.enabledTools,
      simulateSpeech: this.simulateSpeech,
      windowTokens: this.windowTokens,
      model: typeof this.model === "string" ? this.model : this.model.modelId,
    });
    if (this.simulateSpeech) {
      this.history.push([
        {
          role: "user",
          content:
            "本次为静音模拟测试：台词仅以字幕和动作展示，没有真实语音；所有播放反馈仅表示模拟进度，不代表真实发声。",
        },
      ]);
    }
    if (entry.context.trim()) {
      this.history.push([{ role: "user", content: `交接上下文：${entry.context}` }]);
    }
    return { status: "confirmed" as const };
  }

  /** 连接回调只入队；用户打断立即取消当前轮次，普通消息等下一轮处理。 */
  private receive(event: InputEvent | ObservationEvent): void {
    if (event.type === "observation") {
      this.log.info("互动收到截图观察", {
        round: this.roundNumber,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title: event.screen.title,
        url: event.screen.url,
        width: event.screen.width,
        height: event.screen.height,
      });
    } else {
      this.log.info("互动收到事件", { round: this.roundNumber, ...event });
    }
    if (event.type === "performance" && event.status === "speech") {
      this.speechFeedback.push(event);
      return;
    }
    if (event.type === "interrupt" || event.type === "exit") {
      this.waiting?.abort();
      this.paused = event.type === "interrupt";
      this.ending = event.type === "exit";
      if (this.ending) {
        this.compressionController.abort(new Error("用户结束互动"));
      }
      this.connection.notify({ type: "interrupt" });
      this.round?.abort(new Error("用户打断当前轮次"));
    }
    this.pendingEvents.push(event);
    this.inputReady.emit("input");
  }

  /** 完整的互动 loop：没有输入时休眠，新输入唤醒；宿主只等待最终退出结果。 */
  async run({ signal }: SceneExecution): Promise<SceneResult> {
    signal.throwIfAborted();
    this.connection.start();
    this.history.push([
      {
        role: "user",
        content: "互动开始，请根据本次启用的工具和交接上下文，决定接下来做什么。",
      },
    ]);
    this.receive({ type: "continue" });
    try {
      while (true) {
        signal.throwIfAborted();
        if (!this.pendingEvents.length) {
          await once(this.inputReady, "input", { signal });
          continue;
        }
        const batch = this.pendingEvents.splice(0);
        this.log.info("互动消费事件批次", {
          round: this.roundNumber,
          count: batch.length,
          types: batch.map((event) => event.type),
          speechFeedback: this.speechFeedback.length,
          pending: this.pendingEvents.length,
        });
        const round = new AbortController();
        this.round = round;
        try {
          const result = await this.runRound(batch, AbortSignal.any([signal, round.signal]));
          signal.throwIfAborted();
          if (result) {
            this.log.info("互动结束", { round: this.roundNumber, reason: result.reason });
            this.publishActivity("ended", result.reason);
            return result;
          }
        } catch (error) {
          if (!round.signal.aborted || signal.aborted) {
            throw error;
          }
          this.log.info("互动轮次取消", {
            round: this.roundNumber,
            reason: String(round.signal.reason),
          });
          this.publishActivity(this.ending ? "ended" : "paused");
          // 等本轮模型和工具取消完毕，再读取包括打断事件在内的下一批输入。
        } finally {
          this.round = undefined;
        }
      }
    } catch (error) {
      if (signal.aborted) {
        this.log.info("互动被取消", { round: this.roundNumber, reason: String(signal.reason) });
      } else {
        this.log.error("互动运行失败", { round: this.roundNumber, error });
      }
      this.publishActivity(signal.aborted ? "ended" : "failed", String(error));
      throw error;
    } finally {
      this.waiting?.abort();
      this.compressionController.abort();
      await this.compressionTask;
    }
  }

  private async runRound(
    events: (InputEvent | ObservationEvent)[],
    signal: AbortSignal,
  ): Promise<SceneResult | undefined> {
    const inputs: ModelMessage[] = this.speechFeedback.splice(0).map((input) => ({
      role: "user",
      content: `${this.simulateSpeech ? "静音模拟播放反馈（未真实发声）：\n" : ""}${JSON.stringify(input)}`,
    }));
    let exitReason: string | undefined;
    for (const input of events) {
      if (input.type === "observation") {
        // 工具执行完成后才消费这一批观察；最后一个历史单元是刚写入的完整工具步骤。
        // 在压缩检查前补齐截图，调用、回执与观察不会被压缩边界拆开。
        this.history.at(-1)!.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `${input.toolName}（tool_call_id: ${input.toolCallId}）返回的截图：`,
            },
            { type: "file", mediaType: "image/jpeg", data: input.screen.image },
          ],
        });
        continue;
      }
      if (input.type === "exit") {
        exitReason = input.reason;
      } else if (input.type === "performance") {
        this.performances.delete(input.toolCallId);
      } else if (input.type === "interrupt") {
        this.paused = true;
      } else if (input.type === "message" || input.type === "continue") {
        this.paused = false;
        this.waiting?.abort();
      }
      let content = JSON.stringify(input);
      if (
        input.type === "performance" &&
        (input.status === "interrupted" || input.status === "failed") &&
        input.incompleteSpeech !== null
      ) {
        content = `以下 incompleteSpeech.text 是未完整播放的整句台词；仅确认音频播放时长，不代表全文已说出，也不能按时长比例推算已说出的字：\n${content}`;
      }
      if (this.simulateSpeech && input.type === "performance") {
        content = `静音模拟播放反馈（未真实发声）：\n${content}`;
      }
      inputs.push({ role: "user", content });
    }
    if (inputs.length > 0) {
      this.history.push(inputs);
    }
    if (exitReason !== undefined) {
      // 主动退出不再调用模型；带回已生成的台本和真实播放反馈，避免关闭等待额外 LLM。
      return { reason: exitReason, context: this.describeExit() };
    }
    if (this.paused || this.ending) {
      this.publishActivity(this.ending ? "ended" : "paused");
      return;
    }
    this.waiting?.abort();
    this.roundNumber += 1;
    this.publishActivity("preparing");
    const decision: RoundDecision = {};
    const tools = createInteractionTools(
      this.connection,
      this.performances,
      signal,
      decision,
      (event) => this.receive(event),
    );
    const activeTools: (keyof typeof tools)[] = [
      ...this.enabledTools,
      "vtuber_act",
      "wait",
      "finish",
    ];
    const toolDescription = JSON.stringify(
      await Promise.all(
        activeTools.map(async (name) => ({
          name,
          description: tools[name].description,
          inputSchema: await asSchema<unknown>(tools[name].inputSchema).jsonSchema,
        })),
      ),
    );
    // 压缩保留相同的工具定义和顺序，但不携带任何执行入口。
    const compressionTools = Object.fromEntries(
      Object.entries(tools)
        .filter(([name]) => activeTools.includes(name as keyof typeof tools))
        .map(([name, definition]) => [
          name,
          { description: definition.description, inputSchema: definition.inputSchema },
        ]),
    );
    const messages = await this.prepareContext(toolDescription, compressionTools, signal);
    const requestEstimate = estimateInputTokens(messages, toolDescription);
    const result = await generateText({
      model: this.model,
      messages,
      allowSystemInMessages: true,
      abortSignal: signal,
      maxRetries: 0,
      stopWhen: stepCountIs(1),
      tools,
      activeTools,
      onLanguageModelCallStart: () => {
        this.publishActivity("model");
      },
      onLanguageModelCallEnd: ({ modelId, usage, performance }) => {
        this.log.info("互动模型请求完成", {
          round: this.roundNumber,
          model: modelId,
          durationMs: performance.responseTimeMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
        });
        this.connection.notify({
          type: "model_usage",
          at: Date.now(),
          model: modelId,
          durationMs: performance.responseTimeMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
        });
      },
      onToolExecutionStart: ({ toolCall }) => {
        const detail = JSON.stringify(toolCall.input);
        this.publishActivity("tools");
        this.connection.notify({
          type: "tool_execution",
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          state: "running",
          at: Date.now(),
          detail,
        });
        this.log.info("互动场景调用工具", {
          round: this.roundNumber,
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          input: detail,
        });
      },
      onToolExecutionEnd: ({ toolCall, toolOutput, toolExecutionMs }) => {
        let failed: boolean;
        let detail: string;
        if (toolOutput.type === "tool-error") {
          failed = true;
          detail = String(toolOutput.error);
        } else {
          // 本场景仅注册下列静态工具，SDK 的动态工具 unknown 分支不适用。
          const output = toolOutput.output as InferToolOutput<(typeof tools)[keyof typeof tools]>;
          detail = JSON.stringify(output);
          failed =
            ("ok" in output && !output.ok) || ("status" in output && output.status === "failed");
        }
        this.connection.notify({
          type: "tool_execution",
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          state: failed ? (signal.aborted ? "cancelled" : "failed") : "completed",
          at: Date.now(),
          detail,
          durationMs: toolExecutionMs,
        });
        this.log.info("互动工具执行结束", {
          round: this.roundNumber,
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          failed,
          cancelled: failed && signal.aborted,
          durationMs: toolExecutionMs,
          result: detail,
        });
      },
      onStepEnd: ({ response, usage }) => {
        this.inputUsage = readInputTokenUsage(requestEstimate, usage);
        // 每轮只有一个 SDK 步骤；下一轮消费观察时再向此单元追加对应截图。
        this.history.push(response.messages);
      },
    });
    this.log.info("互动模型轮次结束", {
      round: this.roundNumber,
      finishReason: result.finishReason,
      pending: this.pendingEvents.length,
      performances: this.performances.size,
    });
    signal.throwIfAborted();
    if (decision.summary !== undefined) {
      return {
        reason: "互动结束",
        context: `${this.simulateSpeech ? "本次为静音模拟测试，没有真实发声。\n" : ""}${decision.summary}`,
      };
    }
    if (decision.waitSeconds !== undefined) {
      this.schedule(decision.waitSeconds);
    } else if (this.pendingEvents.length > 0) {
      // 截图、用户输入或表演反馈已经入队；由外层 loop 成批消费，不额外安排定时续跑。
      return;
    } else if (decision.performanceQueued) {
      // 新表演只触发一次续跑；合成和播放不阻塞观察与操作，busy 回执不走此分支。
      this.receive({ type: "continue" });
    } else if (
      result.content.some((part) => part.type === "tool-error") ||
      result.toolResults.some(({ output }) => {
        const value = output as InferToolOutput<(typeof tools)[keyof typeof tools]>;
        return ("ok" in value && !value.ok) || ("status" in value && value.status === "failed");
      })
    ) {
      // 失败回执已写入历史；下一轮由模型决定如何处理，不重放工具。
      this.receive({ type: "continue" });
    } else if (this.performances.size) {
      this.publishActivity("performance");
    } else {
      throw new Error("互动轮次未安排后续活动：请通过工具操作、等待或结束互动");
    }
  }

  private schedule(seconds: number) {
    this.waiting?.abort();
    const controller = new AbortController();
    this.waiting = controller;
    this.publishActivity("waiting", undefined, Date.now() + seconds * 1000);
    this.resumeAfter(seconds, controller);
  }

  private async resumeAfter(seconds: number, controller: AbortController) {
    try {
      await delay(seconds * 1000, undefined, { signal: controller.signal });
      this.receive({ type: "continue" });
    } catch (error) {
      if (!controller.signal.aborted) {
        this.log.error("互动等待结束事件投递失败", { round: this.roundNumber, error });
      }
    }
  }

  /** 每次模型请求前应用摘要；70% 后台压缩，85% 等待压缩释放空间。 */
  private async prepareContext(
    toolDescription: string,
    tools: ToolSet,
    signal: AbortSignal,
  ): Promise<ModelMessage[]> {
    while (true) {
      signal.throwIfAborted();
      if (this.compressed) {
        this.log.info("互动应用压缩摘要", {
          round: this.roundNumber,
          units: this.compressed.count,
          summaryChars: this.compressed.summary.length,
        });
        this.summary = this.compressed.summary;
        this.history = this.history.slice(this.compressed.count);
        this.compressed = undefined;
        this.inputUsage = undefined;
        this.connection.notify({ type: "trace", name: "压缩", detail: this.summary });
        this.connection.notify({ type: "compression_status", state: "applied", at: Date.now() });
      }
      const messages: ModelMessage[] = [
        { role: "system", content: this.instructions },
        ...(this.summary
          ? [{ role: "user" as const, content: `此前互动摘要：${this.summary}` }]
          : []),
        ...this.history.flat(),
      ];
      const contextTokens = estimateInputTokens(messages, toolDescription, this.inputUsage);
      this.log.info("互动上下文检查", {
        round: this.roundNumber,
        tokens: contextTokens,
        windowTokens: this.windowTokens,
        messageCount: messages.length,
      });
      this.connection.notify({
        type: "context_usage",
        tokens: contextTokens,
        windowTokens: this.windowTokens,
      });
      if (
        contextTokens >= this.windowTokens * 0.7 &&
        !this.compressionTask &&
        this.history.length > 1
      ) {
        // 保留约 10% 窗口的近期完整交互，工具调用与结果不能拆开。
        let keepFrom = this.history.length;
        let retainedTokens = 0;
        do {
          keepFrom -= 1;
          retainedTokens += estimateInputTokens(this.history[keepFrom], "", this.inputUsage);
        } while (keepFrom > 0 && retainedTokens < this.windowTokens * 0.1);
        if (keepFrom > 0) {
          this.compressionTask = this.compress(
            structuredClone(this.history.slice(0, keepFrom)),
            this.summary,
            toolDescription,
            tools,
            this.inputUsage,
          ).finally(() => {
            this.compressionTask = undefined;
          });
        }
      }
      if (contextTokens < this.windowTokens * 0.85) {
        // 后续工具步骤不能修改本次请求或后台压缩持有的快照。
        return structuredClone(messages);
      }
      if (!this.compressionTask) {
        throw new Error("互动上下文达到 85%，没有可压缩的完整旧交互");
      }

      // 打断只取消前台等待，后台压缩可继续；退出场景时统一取消后台任务。
      this.publishActivity("compressing");
      let abort!: () => void;
      try {
        await Promise.race([
          this.compressionTask,
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
          }),
        ]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
      signal.throwIfAborted();
      if (!this.compressed) {
        throw new Error("互动上下文达到 85%，压缩失败，暂停生成");
      }
      // 压缩期间可能新增交互；应用摘要后重新检查容量。
    }
  }

  /** 后台只整理快照；前台在下一次请求前替换对应历史前缀。 */
  private async compress(
    units: ModelMessage[][],
    summary: string,
    toolDescription: string,
    tools: ToolSet,
    inputUsage?: InputTokenUsage,
  ) {
    const signal = this.compressionController.signal;
    const startedAt = Date.now();
    this.log.info("互动开始压缩", { round: this.roundNumber, units: units.length });
    this.connection.notify({ type: "compression_status", state: "running", at: Date.now() });
    try {
      signal.throwIfAborted();
      const prefix: ModelMessage[] = [
        { role: "system", content: this.instructions },
        ...(summary ? [{ role: "user" as const, content: `此前互动摘要：${summary}` }] : []),
      ];
      const instruction: ModelMessage = { role: "user", content: this.compressionPrompt };
      // 压缩请求也必须放得进窗口；未覆盖的完整交互留给下一次处理。
      while (
        units.length &&
        estimateInputTokens(
          [...prefix, ...units.flat(), instruction],
          toolDescription,
          inputUsage,
        ) >= this.windowTokens
      ) {
        units.pop();
      }
      if (!units.length) {
        throw new Error("互动场景没有能放入压缩请求的完整旧交互");
      }
      const result = await generateText({
        model: this.model,
        messages: [...prefix, ...units.flat(), instruction],
        tools,
        toolChoice: "none",
        allowSystemInMessages: true,
        abortSignal: signal,
        maxRetries: 0,
      });
      signal.throwIfAborted();
      if (result.finishReason !== "stop" || !result.text.trim() || result.toolCalls.length) {
        throw new Error("互动上下文摘要未完整生成");
      }
      const text = result.text.trim();
      if (
        estimateInputTokens([{ role: "user", content: `此前互动摘要：${text}` }], "", inputUsage) >=
        estimateInputTokens([...prefix.slice(1), ...units.flat()], "", inputUsage)
      ) {
        throw new Error("互动摘要未缩短上下文，保留原历史");
      }
      this.compressed = { summary: text, count: units.length };
      this.log.info("互动压缩完成", {
        round: this.roundNumber,
        units: units.length,
        summaryChars: text.length,
        durationMs: Date.now() - startedAt,
      });
      this.connection.notify({ type: "compression_status", state: "ready", at: Date.now() });
    } catch (error) {
      this.connection.notify({
        type: "compression_status",
        state: signal.aborted ? "cancelled" : "failed",
        at: Date.now(),
        detail: String(error),
      });
      if (!signal.aborted) {
        this.log.error("互动上下文压缩失败", {
          round: this.roundNumber,
          durationMs: Date.now() - startedAt,
          error,
        });
      } else {
        this.log.info("互动压缩取消", {
          round: this.roundNumber,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  private describeExit() {
    // 只交回实际输入和工具结果，不把未播放的台本当作已经说出的内容。
    const recent: string[] = [];
    for (const message of this.history.slice(-8).flat()) {
      if (message.role === "user" && typeof message.content === "string") {
        recent.push(message.content);
      } else if (message.role === "tool") {
        for (const part of message.content) {
          if (part.type !== "tool-result") {
            continue;
          }
          const output = part.output;
          if (output.type === "content") {
            recent.push(
              `${part.toolName}: ${output.value
                .filter((item) => item.type === "text")
                .map((item) => item.text)
                .join("\n")}`,
            );
          } else if (output.type === "json" || output.type === "text") {
            recent.push(`${part.toolName}: ${JSON.stringify(output.value)}`);
          }
        }
      }
    }
    return `${this.simulateSpeech ? "本次为静音模拟测试，没有真实发声。\n" : ""}${this.summary}\n最近交互与执行记录：\n${recent.join("\n").slice(-5000)}`;
  }

  async dispose() {
    this.ending = true;
    this.waiting?.abort();
    this.compressionController.abort();
    await this.compressionTask;
    await this.connection?.close();
  }
}
