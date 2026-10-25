/** 一次播放的时间轴与口型都来自同一个 AudioContext，停止后不再触发旧帧回调。 */
export class AudioPlayer {
  private context: AudioContext | null = null;

  /** 从用户点击事件调用，满足浏览器音频播放授权要求。 */
  async activate() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  async play(
    audio: ArrayBuffer | { silentDurationMs: number },
    signal: AbortSignal,
    onFrame: (progress: number, mouth: number) => void,
    onStart: () => void,
    onEnd: (playback: { completed: boolean; playedMs: number; durationMs: number }) => void,
  ): Promise<void> {
    const context = this.context!;
    // 静音模拟也走同一音频时钟、结束事件与取消路径。
    const buffer =
      audio instanceof ArrayBuffer
        ? await context.decodeAudioData(audio)
        : context.createBuffer(
            1,
            Math.ceil((audio.silentDurationMs * context.sampleRate) / 1000),
            context.sampleRate,
          );
    signal.throwIfAborted();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);

    await new Promise<void>((resolve, reject) => {
      let frame = 0;
      const startedAt = context.currentTime;
      const abort = () => {
        source.stop();
        finish(signal.reason);
      };
      const finish = (error?: unknown) => {
        cancelAnimationFrame(frame);
        signal.removeEventListener("abort", abort);
        source.onended = null;
        source.disconnect();
        analyser.disconnect();
        // -1 只表示释放口型，不能再次触发位于句首的动作。
        onFrame(-1, 0);
        // 与音频结束同一调用栈记录事实，不等附带动作或 Promise 的后续任务。
        onEnd({
          completed: error === undefined,
          playedMs:
            (error === undefined
              ? buffer.duration
              : Math.min(buffer.duration, context.currentTime - startedAt)) * 1000,
          durationMs: buffer.duration * 1000,
        });
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const update = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
        onFrame(
          Math.min(1, (context.currentTime - startedAt) / buffer.duration),
          Math.min(1, rms * 5),
        );
        frame = requestAnimationFrame(update);
      };
      source.onended = () => finish();
      signal.addEventListener("abort", abort, { once: true });
      source.start();
      onStart();
      update();
    });
  }

  async dispose() {
    await this.context?.close();
    this.context = null;
  }
}
