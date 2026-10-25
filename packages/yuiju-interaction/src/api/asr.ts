import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { InteractionConfig } from "../config.ts";

/** 识别麦克风生成的单声道 PCM16 WAV；只返回最终句子，不向模型提交中间结果。 */
export async function transcribeSpeech(
  audio: Blob,
  signal: AbortSignal,
  config: NonNullable<InteractionConfig["asr"]>,
): Promise<string> {
  const wav = Buffer.from(await audio.arrayBuffer());
  // 与 microphone.ts 的 encodeWav 契约一致：标准 PCM WAV，采样率位于第 24 字节。
  const sampleRate = wav.readUInt32LE(24);
  signal.throwIfAborted();
  const socket = new WebSocket(config.endpoint, {
    headers: { Authorization: `Bearer ${config.api_key}` },
  });
  const taskId = randomUUID();
  const sentences: string[] = [];
  const abort = () => socket.terminate();
  signal.addEventListener("abort", abort, { once: true });

  try {
    // WebSocket 以事件返回任务进度；在此收敛为一次可 await 的识别调用。
    return await new Promise<string>((resolve, reject) => {
      socket.on("error", (error) => reject(signal.aborted ? signal.reason : error));
      socket.once("close", (code) => {
        reject(signal.aborted ? signal.reason : new Error(`ASR 连接提前关闭（${code}）`));
      });
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            header: { action: "run-task", task_id: taskId, streaming: "duplex" },
            payload: {
              task_group: "audio",
              task: "asr",
              function: "recognition",
              model: config.model,
              parameters: { format: "wav", sample_rate: sampleRate },
              input: {},
            },
          }),
        );
      });
      socket.on("message", (data) => {
        try {
          signal.throwIfAborted();
          const event = JSON.parse(data.toString());
          switch (event.header.event) {
            case "task-started":
              // 必须等待服务端启动成功；二进制音频与结束指令按发送顺序到达。
              socket.send(wav);
              socket.send(
                JSON.stringify({
                  header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
                  payload: { input: {} },
                }),
              );
              break;
            case "result-generated": {
              const sentence = event.payload.output.sentence;
              if (sentence.sentence_end && !sentence.heartbeat) {
                sentences.push(sentence.text);
              }
              break;
            }
            case "task-finished": {
              const text = sentences.join("").trim();
              if (!text) {
                throw new Error("未识别到有效语音，请再说一次");
              }
              resolve(text);
              break;
            }
            case "task-failed":
              throw new Error(
                `ASR 识别失败（${event.header.error_code}）：${event.header.error_message}`,
              );
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    signal.removeEventListener("abort", abort);
    socket.close();
  }
}
