import type { InteractionConfig } from "../config.ts";

/** 根据情感选择参考音色，返回整段 WAV；取消信号同时中止请求和音频读取。 */
export async function synthesizeSpeech({
  text,
  emotion,
  signal,
  config,
}: {
  text: string;
  emotion: string;
  signal: AbortSignal;
  config: InteractionConfig["tts"];
}): Promise<Blob> {
  signal.throwIfAborted();
  if (!Object.hasOwn(config.references, emotion)) {
    throw new Error(`TTS 未配置情感音色：${emotion}`);
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
      model: config.model,
    },
    body: JSON.stringify({
      ...config.request,
      text,
      reference_id: config.references[emotion],
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Fish Audio TTS 请求失败（${response.status}）：${(await response.text()).slice(0, 500)}`,
    );
  }
  return new Blob([await response.arrayBuffer()], { type: "audio/wav" });
}
