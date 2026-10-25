/** 简单能量检测：连续 180ms 超过 -42dBFS 开始，静音 500ms 结束，保留 320ms 头部音频。 */
export async function openMicrophone(
  workletUrl: string,
  signal: AbortSignal,
  onStart: () => void,
  onSpeech: (audio: Blob) => void,
  onLevel: (level: number, speaking: boolean) => void,
) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  if (signal.aborted) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    signal.throwIfAborted();
  }
  const context = new AudioContext();
  const close = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    context.close();
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    await context.audioWorklet.addModule(workletUrl);
    signal.throwIfAborted();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "microphone-capture");
    source.connect(capture);
    // Worklet 输出为静音，接 destination 使音频图持续运转，不回放麦克风。
    capture.connect(context.destination);
    let leading: Float32Array[] = [];
    let frames: Float32Array[] = [];
    let speaking = false;
    let loudMs = 0;
    let quietMs = 0;

    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (signal.aborted) {
        return;
      }
      const frame = event.data;
      const milliseconds = (frame.length / context.sampleRate) * 1000;
      const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
      const loud = 20 * Math.log10(rms) >= -42;
      loudMs = loud ? loudMs + milliseconds : 0;
      quietMs = loud ? 0 : quietMs + milliseconds;
      if (!speaking) {
        leading.push(frame);
        while (leading.length * milliseconds > 320) {
          leading.shift();
        }
        if (loudMs >= 180) {
          speaking = true;
          frames = leading;
          leading = [];
          onStart();
        }
      } else {
        frames.push(frame);
        if (quietMs >= 500) {
          onSpeech(encodeWav(frames, context.sampleRate));
          frames = [];
          speaking = false;
          loudMs = 0;
        }
      }
      onLevel(Math.min(1, rms * 5), speaking);
    };
  } catch (error) {
    signal.removeEventListener("abort", close);
    for (const track of stream.getTracks()) {
      track.stop();
    }
    if (context.state !== "closed") {
      await context.close();
    }
    throw error;
  }
}

/** 将单次发言封装为 PCM16 WAV，采样率保留浏览器实际值，由 ASR 适配器处理要求。 */
function encodeWav(frames: Float32Array[], sampleRate: number): Blob {
  const sampleCount = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, buffer.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const frame of frames) {
    for (const sample of frame) {
      view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 32767, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
