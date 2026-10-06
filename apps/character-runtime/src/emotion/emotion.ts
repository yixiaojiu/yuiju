import { getRedis } from "@yuiju/shared/database/redis";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { Output } from "ai";
import { z } from "zod";
import { characterKey, commitCharacterTransaction } from "../storage";

type Feeling = { id: string; content: string; occurredAt: number };
export type EmotionState = {
  pleasure: number;
  activation: number;
  control: number;
  updatedAt: number;
  /** 可同时保留多件事的感受；由模型合并或解除，按实际感受时间记录。 */
  feelings: Feeling[];
};

const changeSchema = z
  .number()
  .int()
  .min(-3)
  .max(3)
  .describe("你判断的变化方向与强度：0 不变，±1 轻微，±2 明显，±3 强烈");
const emotionUpdateSchema = z.strictObject({
  pleasure: changeSchema,
  activation: changeSchema,
  control: changeSchema,
  feelings: z
    .array(
      z.strictObject({
        sourceId: z.string().describe("已有感受或新提交的实际来源 id"),
        content: z.string().min(1).describe("你此刻对这件事的感受，不编造原因"),
      }),
    )
    .max(12),
});

/** 数值只表达三种维度，不据组合推测生气、悲伤或具体原因。 */
export function describeEmotion(state: EmotionState): string {
  const bands = {
    pleasure: [
      "整体感受很不愉快",
      "整体感受偏不愉快",
      "愉快与不愉快的倾向均不突出",
      "整体感受比较愉快",
      "整体感受非常愉快",
    ],
    activation: [
      "情绪激活程度很低",
      "情绪较平静",
      "情绪激活程度适中",
      "情绪较活跃",
      "情绪高度激活，较为激动",
    ],
    control: [
      "明显感到受制，难以影响当前处境",
      "有些受制，觉得能影响处境的空间有限",
      "自主与受制的倾向均不突出",
      "比较有自主感，觉得能够影响当前处境",
      "自主感很强，觉得能主动影响当前处境",
    ],
  };
  return (["pleasure", "activation", "control"] as const)
    .map((dimension) => bands[dimension][Math.min(4, Math.floor(state[dimension] / 20))])
    .join("；");
}

/** 每个角色独立接收和处理感受；提交只等 Redis，不等待情绪模型。 */
export class Emotion {
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly stopping = new AbortController();
  private active = false;
  private wakeRequested = false;

  constructor(private readonly characterId: string) {}

  async initialize(): Promise<void> {
    await (await getRedis()).set(
      `${characterKey(this.characterId)}:emotion:state`,
      JSON.stringify({
        pleasure: 50,
        activation: 50,
        control: 50,
        updatedAt: 0,
        feelings: [],
      } satisfies EmotionState),
      "NX",
    );
  }

  start(): void {
    this.active = true;
    this.wake();
  }

  async read(): Promise<EmotionState> {
    const value = await (await getRedis()).get(`${characterKey(this.characterId)}:emotion:state`);
    if (value === null) {
      throw new Error("角色情绪尚未初始化");
    }
    return JSON.parse(value);
  }

  async submit(id: string, content: string, occurredAt: number): Promise<void> {
    const redis = await getRedis();
    const key = characterKey(this.characterId);
    const feeling: Feeling = { id, content, occurredAt };
    await redis.eval(
      `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'PX', 2592000000)
redis.call('HSETNX', KEYS[3], ARGV[1], ARGV[3])
return 1
`,
      3,
      `${key}:emotion:pending`,
      `${key}:emotion:received:${encodeURIComponent(id)}`,
      `${key}:memory:pending`,
      id,
      JSON.stringify(feeling),
      JSON.stringify({ id, occurredAt, source: "feeling", content, people: [] }),
    );
    this.wake();
  }

  private wake(): void {
    this.wakeRequested = true;
    if (this.active && !this.running) {
      clearTimeout(this.timer);
      this.running = this.process();
    }
  }

  private async process(): Promise<void> {
    this.wakeRequested = false;
    let nextAt: number | undefined;
    try {
      const redis = await getRedis();
      const key = characterKey(this.characterId);
      const pending: Feeling[] = (await redis.hvals(`${key}:emotion:pending`)).map((value) =>
        JSON.parse(value),
      );
      if (!pending.length) {
        return;
      }
      const previous = await this.read();
      if (Date.now() < previous.updatedAt + 30_000) {
        nextAt = previous.updatedAt + 30_000;
        return;
      }
      const result = await generateStructuredOutput({
        model: flashModel,
        output: Output.object({ schema: emotionUpdateSchema }),
        instructions: await renderPrompt("emotion.update"),
        prompt: JSON.stringify({ previous, pending }),
        abortSignal: this.stopping.signal,
      });
      const sources = new Map(
        [...previous.feelings, ...pending].map((feeling) => [feeling.id, feeling]),
      );
      const state: EmotionState = {
        ...previous,
        updatedAt: Date.now(),
        feelings: result.output.feelings.map((feeling) => {
          const source = sources.get(feeling.sourceId);
          if (!source) {
            throw new Error(`情绪引用了不存在的感受：${feeling.sourceId}`);
          }
          return { id: source.id, content: feeling.content, occurredAt: source.occurredAt };
        }),
      };
      const amounts = [0, 5, 15, 30];
      for (const dimension of ["pleasure", "activation", "control"] as const) {
        const direction = result.output[dimension];
        state[dimension] = Math.max(
          0,
          Math.min(100, previous[dimension] + Math.sign(direction) * amounts[Math.abs(direction)]),
        );
      }
      await commitCharacterTransaction(
        redis
          .multi()
          .set(`${key}:emotion:state`, JSON.stringify(state))
          .hdel(`${key}:emotion:pending`, ...pending.map((feeling) => feeling.id)),
      );
      nextAt = state.updatedAt + 30_000;
    } catch (error) {
      if (this.active) {
        logger.error("情绪处理失败，保留感受等待下一次处理", {
          characterId: this.characterId,
          error,
        });
        nextAt = Date.now() + 30_000;
      }
    } finally {
      this.running = undefined;
      if (this.active && nextAt !== undefined) {
        this.timer = setTimeout(() => this.wake(), Math.max(0, nextAt - Date.now()));
      } else if (this.active && this.wakeRequested) {
        this.wake();
      }
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.stopping.abort();
    await this.running;
  }
}
