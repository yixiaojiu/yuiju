import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { generateStructuredOutput } from "@yuiju/shared/llm/generate-structured-output";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import { Output } from "ai";
import { z } from "zod";
import type { CharacterEvent } from "../agent-loop/events";
import { characterKey, commitCharacterTransaction } from "../storage";

type Feeling = { id: string; content: string; occurredAt: number };
/** 一批感受只反馈一次；处理结果不是新的经历或感受。 */
export type EmotionResult = {
  requestIds: string[];
  status: "updated" | "unchanged" | "rejected" | "failed";
  description: string;
};
export type EmotionState = {
  pleasure: number;
  activation: number;
  control: number;
  updatedAt: number;
  /** 仍持续影响此刻的事项，不是经历清单；保留原发生时间，最多 12 条、每条 100 字符。 */
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
        content: z.string().min(1).describe("仍在影响你此刻的事项，简短直接，最多 100 字符"),
      }),
    )
    .max(12),
  summary: z
    .string()
    .min(1)
    .describe("简短说明本批的情绪变化及感受的保留、合并或移除；无需变化时说明原因"),
});
const emotionReviewSchema = z.strictObject({
  approved: z.boolean(),
  issues: z.array(z.string()).describe("未通过的具体问题；通过时为空数组"),
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
  /** 未更新状态的批次也占用处理间隔，避免失败后新提交绕过合批限制。 */
  private processedAt = 0;

  constructor(
    private readonly characterId: string,
    private readonly onResult: () => void,
  ) {}

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
      const allowedAt = Math.max(previous.updatedAt, this.processedAt) + 30_000;
      if (Date.now() < allowedAt) {
        nextAt = allowedAt;
        return;
      }
      const { state, result } = await this.reviewUpdate(previous, pending);
      this.stopping.signal.throwIfAborted();
      const event: CharacterEvent = {
        id: randomUUID(),
        type: "emotion_result",
        occurredAt: Date.now(),
        result,
      };
      // 只有状态确认提交后才能通知主 loop；结果和消费同批完成，重启后从 inbox 接续。
      const transaction = redis.multi();
      if (result.status === "updated") {
        transaction.set(`${key}:emotion:state`, JSON.stringify(state));
      }
      transaction
        .hdel(`${key}:emotion:pending`, ...result.requestIds)
        .hset(`${key}:agent:inbox`, event.id, JSON.stringify(event));
      await commitCharacterTransaction(transaction);
      this.processedAt = event.occurredAt;
      this.onResult();
      nextAt = this.processedAt + 30_000;
    } catch (error) {
      if (this.active) {
        // 模型失败已转为结果；此处是存储或生命周期异常，不发布未确认结果或定时重跑。
        logger.error("情绪处理未能提交结果", { error });
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

  /** 更新和审查共用固定依据；意见最多修改三轮，异常或最终驳回都结束本批。 */
  private async reviewUpdate(
    previous: EmotionState,
    pending: Feeling[],
  ): Promise<{ state: EmotionState; result: EmotionResult }> {
    const requestIds = pending.map((feeling) => feeling.id);
    let candidate: z.infer<typeof emotionUpdateSchema> | undefined;
    let issues: string[] = [];
    try {
      const timezone = (await load_config()).app!.timezone!;
      // 只改变给模型看的日期格式，保存时仍沿用来源的实际时间。
      const context = {
        currentTime: formatLlmDateTime(Date.now(), timezone),
        previous: {
          ...previous,
          updatedAt:
            previous.updatedAt === 0 ? null : formatLlmDateTime(previous.updatedAt, timezone),
          feelings: previous.feelings.map((feeling) => ({
            ...feeling,
            occurredAt: formatLlmDateTime(feeling.occurredAt, timezone),
          })),
        },
        pending: pending.map((feeling) => ({
          ...feeling,
          occurredAt: formatLlmDateTime(feeling.occurredAt, timezone),
        })),
      };
      const [updatePrompt, reviewPrompt] = await Promise.all([
        renderPrompt("emotion.update"),
        renderPrompt("emotion.review"),
      ]);
      const sources = new Map(
        [...previous.feelings, ...pending].map((feeling) => [feeling.id, feeling]),
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const generated = await generateStructuredOutput({
          model: flashModel,
          output: Output.object({ schema: emotionUpdateSchema }),
          instructions: updatePrompt,
          prompt: JSON.stringify({ ...context, candidate, issues }),
          abortSignal: this.stopping.signal,
        });
        if (generated.finishReason !== "stop") {
          throw new Error(`情绪更新未完整生成：${generated.finishReason}`);
        }
        candidate = generated.output;
        // 契约错误交回生成者修正，不由程序截断、补造来源或静默去重。
        issues = [];
        const sourceIds = new Set<string>();
        for (const feeling of candidate.feelings) {
          if (!sources.has(feeling.sourceId)) {
            issues.push(`感受引用了不存在的来源：${feeling.sourceId}`);
          }
          if (sourceIds.has(feeling.sourceId)) {
            issues.push(`同一来源重复保留：${feeling.sourceId}`);
          }
          if (feeling.content.length > 100) {
            issues.push(`感受超过 100 字符：${feeling.sourceId}`);
          }
          sourceIds.add(feeling.sourceId);
        }
        if (issues.length) {
          continue;
        }
        const review = await generateStructuredOutput({
          model: flashModel,
          output: Output.object({ schema: emotionReviewSchema }),
          instructions: reviewPrompt,
          prompt: JSON.stringify({ ...context, candidate }),
          abortSignal: this.stopping.signal,
        });
        if (review.finishReason !== "stop") {
          throw new Error(`情绪审查未完整生成：${review.finishReason}`);
        }
        if (!review.output.approved) {
          issues = review.output.issues;
          continue;
        }

        const state: EmotionState = {
          ...previous,
          feelings: candidate.feelings.map((feeling) => ({
            ...sources.get(feeling.sourceId)!,
            content: feeling.content,
          })),
        };
        const amounts = [0, 5, 15, 30];
        for (const dimension of ["pleasure", "activation", "control"] as const) {
          const direction = candidate[dimension];
          state[dimension] = Math.max(
            0,
            Math.min(
              100,
              previous[dimension] + Math.sign(direction) * amounts[Math.abs(direction)],
            ),
          );
        }
        const changed = JSON.stringify(state) !== JSON.stringify(previous);
        if (changed) {
          state.updatedAt = Date.now();
        }
        return {
          state,
          result: {
            requestIds,
            status: changed ? "updated" : "unchanged",
            description: `${changed ? "已更新" : "无需更新，保留原状态"}：${candidate.summary}\n处理后的情绪：${describeEmotion(state)}\n不要重试本批感受，也不必为处理结果再次提交感受；只有出现新的实质变化时再表达。`,
          },
        };
      }
      return {
        state: previous,
        result: {
          requestIds,
          status: "rejected",
          description: `情绪候选三轮内未通过检查，保留原状态。问题：${issues.join("；")}\n本批已结束，不要重试或改写同一内容重新提交；新发生的事情或实质变化可以正常表达。`,
        },
      };
    } catch (error) {
      this.stopping.signal.throwIfAborted();
      logger.error("情绪更新或审查失败，本批结束", { error });
      return {
        state: previous,
        result: {
          requestIds,
          status: "failed",
          description:
            "情绪更新或审查调用失败，本批未完成，保留原状态。不要重试同一批感受或为此再次调用工具；新发生的事情可以正常表达。",
        },
      };
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.stopping.abort();
    await this.running;
  }
}
