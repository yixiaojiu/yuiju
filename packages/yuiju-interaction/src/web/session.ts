import { z } from "zod";
import type { ClientMessage, Live2DFrame, SceneEntry, ServerMessage } from "../protocol.ts";
import { openMicrophone } from "./audio/microphone.ts";
import type { Live2DStage } from "./live2d/stage.ts";
import { InteractionPerformance, type InteractionUpdate } from "./performance.ts";

export type PageSettings = {
  connection: { url: string; token: string };
  modelPath: string;
  expressions: Record<string, string>;
  asrAvailable: boolean;
};
export type PageUpdate = InteractionUpdate | ServerMessage;

/** 页面只采集、播放和传递事件，不保存另一份 agent 推理上下文。 */
export class InteractionSession {
  private socket?: WebSocket;
  private microphone?: AbortController;
  private recognition?: AbortController;
  private phase = "disconnected";
  private simulateSpeech = false;
  private readonly performance: InteractionPerformance;
  private readonly performanceRequests = new Map<string, string>();
  private heartbeat?: ReturnType<typeof setInterval>;

  private readonly asrUrl: string;
  private readonly settings: PageSettings;
  private readonly publish: (update: PageUpdate) => void;

  constructor(
    apiBasePath: string,
    characterId: string,
    settings: PageSettings,
    stage: Live2DStage,
    publish: (update: PageUpdate) => void,
  ) {
    const query = new URLSearchParams({ characterId });
    this.asrUrl = `${apiBasePath}/asr?${query}`;
    this.settings = settings;
    this.publish = publish;
    this.performance = new InteractionPerformance(
      `${apiBasePath}/tts?${query}`,
      stage,
      Object.keys(settings.expressions),
      (update) => {
        publish(update);
        if (update.type === "subtitle" && this.phase === "running") {
          this.send({ type: "subtitle", text: update.text });
        }
      },
      (event) => {
        if (this.phase !== "running") {
          return;
        }
        if (event.status !== "speech") {
          for (const [id, toolCallId] of this.performanceRequests) {
            if (toolCallId === event.toolCallId) {
              this.performanceRequests.delete(id);
            }
          }
        }
        this.send({ type: "event", event });
      },
    );
  }

  async connect() {
    await this.performance.activateAudio();
    const socket = new WebSocket(this.settings.connection.url);
    this.socket = socket;
    socket.onopen = () => {
      this.send({ type: "hello", role: "page", token: this.settings.connection.token });
      this.heartbeat = setInterval(() => this.send({ type: "ping" }), 20_000);
    };
    socket.onmessage = async (message) => {
      try {
        const event: ServerMessage = JSON.parse(message.data);
        if (event.type === "status") {
          this.phase = event.phase;
        } else if (event.type === "interrupt") {
          this.performance.interrupt();
        } else if (event.type === "cancel" && this.performanceRequests.has(event.id)) {
          this.performance.interrupt();
        } else if (event.type === "request") {
          try {
            if (event.method !== "perform") {
              throw new Error("页面不能执行浏览器操作");
            }
            const input = z
              .object({ toolCallId: z.string(), script: z.string() })
              .parse(event.input);
            this.performanceRequests.set(event.id, input.toolCallId);
            this.performance.enqueue(input.toolCallId, input.script, this.simulateSpeech);
            this.send({
              type: "result",
              id: event.id,
              result: { ok: true, value: { status: "queued" } },
            });
          } catch (error) {
            this.performanceRequests.delete(event.id);
            this.send({
              type: "result",
              id: event.id,
              result: { ok: false, error: String(error) },
            });
          }
        }
        if (event.type !== "request") {
          this.publish(event);
        }
      } catch (error) {
        this.publish({ type: "error", text: String(error) });
      }
    };
    socket.onclose = () => {
      this.phase = "disconnected";
      clearInterval(this.heartbeat);
      this.microphone?.abort();
      this.recognition?.abort();
      this.performance.interrupt();
      this.publish({ type: "status", phase: this.phase, browserConnected: false });
    };
    socket.onerror = () =>
      this.publish({
        type: "error",
        text: "无法连接互动 agent，请确认插件的 WebSocket 已启动，且连接地址正确。",
      });
  }

  /** 场景连接建立后转发实际画面，不将渲染帧混入 agent 的事件队列。 */
  publishFrame(frame: Live2DFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "live2d_frame", frame });
    }
  }

  /** 播放方式在进入时固定，本轮所有表演沿用同一选择。 */
  enter(entry: SceneEntry) {
    this.send(entry);
    this.simulateSpeech = entry.simulateSpeech;
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("场景连接尚未建立");
    }
    this.socket.send(JSON.stringify(message));
  }

  async listen(enabled: boolean) {
    if (!enabled) {
      this.microphone?.abort();
      this.microphone = undefined;
      return;
    }
    const controller = new AbortController();
    this.microphone = controller;
    try {
      await openMicrophone(
        "/extensions/yuiju-interaction/capture-worklet.js",
        controller.signal,
        () => {},
        (audio) => {
          this.recognize(audio);
        },
        () => {},
      );
    } catch (error) {
      controller.abort();
      this.microphone = undefined;
      throw error;
    }
  }

  private async recognize(audio: Blob) {
    const controller = new AbortController();
    this.recognition = controller;
    try {
      const response = await fetch(this.asrUrl, {
        method: "POST",
        body: audio,
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error);
      }
      this.send({ type: "event", event: { type: "message", text: result.text } });
      this.publish({ type: "user", text: result.text });
    } catch (error) {
      if (!controller.signal.aborted) {
        this.publish({ type: "error", text: String(error) });
      }
    }
  }

  async dispose() {
    this.phase = "disconnected";
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.microphone?.abort();
    this.recognition?.abort();
    await this.performance.dispose();
  }
}
