import { config } from '@/config';
import { promises as fs } from 'fs';
import os from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { URL } from 'url';

function sanitizeForTTS(text: string) {
  const removed = text.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, '');
  return removed.replace(/\s+/g, ' ').trim();
}

function buildTTSBody(text: string) {
  return {
    text,
    text_lang: config.tts.text_lang,
    ref_audio_path: config.tts.ref_audio_path,
    prompt_lang: config.tts.prompt_lang,
    prompt_text: config.tts.prompt_text,
    text_split_method: config.tts.text_split_method,
    media_type: config.tts.media_type,
    streaming_mode: config.tts.streaming_mode,
    temperature: config.tts.temperature,
  };
}

async function requestTTS(body: any): Promise<Buffer> {
  const url = new URL(config.tts.endpoint);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function playWavBuffer(buf: Buffer, opts?: { volume?: number; cleanup?: boolean }) {
  const volume = opts?.volume ?? config.tts.volume ?? 1;
  const tmpWav = join(os.tmpdir(), `yuiju-tts-${Date.now()}.wav`);
  await fs.writeFile(tmpWav, buf);
  await new Promise<void>((resolve, reject) => {
    const p = spawn('afplay', ['-v', String(volume), tmpWav], { stdio: 'ignore' });
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`afplay exit ${code}`))));
    p.on('error', reject);
  });
  await fs.unlink(tmpWav).catch(() => {});
}

export async function synthesizeAndPlay(text: string) {
  const body = buildTTSBody(sanitizeForTTS(text));
  const buf = await requestTTS(body);
  await playWavBuffer(buf);
}
