import type { PerformanceEvent } from "../protocol.ts";
import { AudioPlayer } from "./audio/player.ts";
import { type PerformanceBeat, ScriptParser } from "./live2d/script.ts";
import type { Live2DStage } from "./live2d/stage.ts";

export type PerformanceStatus = {
  type: "performance_status";
  state: "idle" | "tts" | "playing" | "action" | "interrupted" | "failed";
  at: number;
  pending: number;
  detail: string;
};

export type InteractionUpdate =
  | PerformanceStatus
  | {
      type:
        | "status"
        | "user"
        | "reply"
        | "script"
        | "performance"
        | "error"
        | "timing"
        | "subtitle";
      text: string;
    }
  | { type: "audio"; text: string; audio: Blob };

type QueuedPerformance = {
  toolCallId: string;
  beats: PerformanceBeat[];
  simulateSpeech: boolean;
};
type ActivePerformance = QueuedPerformance & {
  controller: AbortController;
  /** 音频异常停止时记录，由终态报告；不按播放时长推测已听字数。 */
  incompleteSpeech: Extract<PerformanceEvent, { status: "interrupted" }>["incompleteSpeech"];
  interrupted: boolean;
};

/** 表演队列：只负责 TTS、Live2D 与执行结果，不调用对话模型，不保存会话历史。 */
export class InteractionPerformance {
  private readonly pending: QueuedPerformance[] = [];
  private active: ActivePerformance | null = null;
  private status: PerformanceStatus = {
    type: "performance_status",
    state: "idle",
    at: Date.now(),
    pending: 0,
    detail: "",
  };
  private readonly player = new AudioPlayer();
  private readonly stage: Live2DStage;
  private readonly expressions: string[];
  private readonly publish: (update: InteractionUpdate) => void;
  private readonly report: (event: PerformanceEvent) => void;

  private readonly ttsUrl: string;

  constructor(
    ttsUrl: string,
    stage: Live2DStage,
    expressions: string[],
    publish: (update: InteractionUpdate) => void,
    report: (event: PerformanceEvent) => void,
  ) {
    this.ttsUrl = ttsUrl;
    this.stage = stage;
    this.expressions = expressions;
    this.publish = publish;
    this.report = report;
  }

  get busy() {
    return this.active !== null || this.pending.length > 0;
  }

  private publishStatus(state: PerformanceStatus["state"], detail = "") {
    this.status = {
      type: "performance_status",
      state,
      at: Date.now(),
      pending: this.pending.length,
      detail,
    };
    this.publish(this.status);
  }

  async activateAudio() {
    await this.player.activate();
  }

  /** 完整解析后入队，调用方此时可返回“已入队”，无需等待实际表演。 */
  enqueue(toolCallId: string, script: string, simulateSpeech: boolean) {
    const parser = new ScriptParser(this.expressions);
    const beats = [...parser.push(script), ...parser.finish()];
    this.pending.push({ toolCallId, beats, simulateSpeech });
    this.status = { ...this.status, pending: this.pending.length };
    this.publish(this.status);
    this.run();
  }

  interrupt() {
    if (this.active && !this.active.interrupted) {
      this.active.interrupted = true;
      this.active.controller.abort();
      this.publish({ type: "subtitle", text: "" });
      this.report({
        type: "performance",
        status: "interrupted",
        toolCallId: this.active.toolCallId,
        incompleteSpeech: this.active.incompleteSpeech,
      });
    }
    for (const item of this.pending.splice(0)) {
      this.report({
        type: "performance",
        status: "interrupted",
        toolCallId: item.toolCallId,
        incompleteSpeech: null,
      });
    }
    this.stage.reset();
    this.publishStatus("interrupted");
  }

  private async run() {
    if (this.active) {
      return;
    }
    while (this.pending.length > 0) {
      const execution: ActivePerformance = {
        ...this.pending.shift()!,
        controller: new AbortController(),
        incompleteSpeech: null,
        interrupted: false,
      };
      this.active = execution;
      let outcome: PerformanceEvent;
      try {
        await this.perform(execution);
        outcome = { type: "performance", status: "completed", toolCallId: execution.toolCallId };
      } catch (error) {
        outcome = {
          type: "performance",
          status: "failed",
          toolCallId: execution.toolCallId,
          error: String(error),
          incompleteSpeech: execution.incompleteSpeech,
        };
        if (!execution.interrupted) {
          this.stage.reset();
        }
      } finally {
        this.active = null;
      }
      // 打断回执已在 interrupt 同步发出；旧执行退出时不再影响新轮次。
      if (!execution.interrupted) {
        this.report(outcome);
        this.publishStatus(
          outcome.status === "failed" ? "failed" : "idle",
          outcome.status === "failed" ? outcome.error : "",
        );
      }
    }
  }

  private async perform(execution: ActivePerformance) {
    const signal = execution.controller.signal;
    for (const beat of execution.beats) {
      signal.throwIfAborted();
      if (beat.type === "action") {
        this.publishStatus("action", beat.tags.join("、"));
        const duration = await this.stage.perform(beat.tags);
        signal.throwIfAborted();
        this.publish({ type: "performance", text: `暂停台词：${beat.tags.join("、")}` });
        await waitForAction(duration, signal);
        continue;
      }
      await this.speak(execution, beat);
      signal.throwIfAborted();
    }
  }

  private async speak(
    execution: ActivePerformance,
    beat: Extract<PerformanceBeat, { type: "speech" }>,
  ) {
    const signal = execution.controller.signal;
    let audio: ArrayBuffer | { silentDurationMs: number };
    if (execution.simulateSpeech) {
      audio = { silentDurationMs: Array.from(beat.text).length * 200 };
    } else {
      const startedAt = performance.now();
      this.publishStatus("tts", beat.text);
      const response = await fetch(this.ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: beat.text }),
        signal,
      });
      if (!response.ok) {
        throw new Error((await response.json()).error);
      }
      const blob = await response.blob();
      signal.throwIfAborted();
      this.publish({ type: "audio", text: beat.text, audio: blob });
      this.publish({ type: "timing", text: `TTS ${Math.round(performance.now() - startedAt)}ms` });
      audio = await blob.arrayBuffer();
    }
    signal.throwIfAborted();
    let cueIndex = 0;
    const actions: Promise<void>[] = [];
    let actionError: unknown;
    // 帧回调不能 await；动作失败取消当前表演，再通过失败事件反馈。
    const performCue = async (tags: Parameters<Live2DStage["perform"]>[0]) => {
      try {
        await this.stage.perform(tags);
      } catch (error) {
        actionError = error;
        execution.controller.abort(error);
      }
    };
    try {
      await this.player.play(
        audio,
        signal,
        (progress, mouth) => {
          this.stage.setMouth(mouth);
          if (progress < 0) {
            return;
          }
          // 接口暂未提供逐字对齐：按播放时长与字符位置估计行内动作时机，不用于推断已听字数。
          while (
            cueIndex < beat.cues.length &&
            beat.cues[cueIndex].offset <= progress * beat.text.length
          ) {
            const cue = beat.cues[cueIndex++];
            actions.push(performCue(cue.tags));
            this.publish({
              type: "performance",
              text: `播放动作（估计时点）：${cue.tags.join("、")}`,
            });
          }
        },
        () => {
          this.publishStatus("playing", beat.text);
          this.publish({ type: "subtitle", text: beat.text });
          this.publish({ type: "reply", text: beat.text });
        },
        ({ completed, playedMs, durationMs }) => {
          this.publish({ type: "subtitle", text: "" });
          if (completed) {
            this.report({
              type: "performance",
              status: "speech",
              toolCallId: execution.toolCallId,
              text: beat.text,
            });
          } else {
            execution.incompleteSpeech = { text: beat.text, playedMs, durationMs };
          }
        },
      );
    } catch (error) {
      await Promise.all(actions);
      throw actionError ?? error;
    }
    signal.throwIfAborted();
    this.publishStatus("action", "等待本句动作完成");
    await Promise.all(actions);
    if (actionError) {
      throw actionError;
    }
    signal.throwIfAborted();
    // 等本句已触发的表情设置完成再复位，避免异步结果重新挂上旧表情。
    this.stage.resetExpression();
  }

  async dispose() {
    this.interrupt();
    await this.player.dispose();
  }
}

/** 阻断动作只等待自身时长，用户插话立即取消等待。 */
function waitForAction(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
