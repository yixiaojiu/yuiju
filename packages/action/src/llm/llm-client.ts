import type { ActionContext, LLMChoiceResult } from '@/types/action';
import { generateText, tool, hasToolCall } from 'ai';
import { logger } from '@/utils/logger';
// deepseek 提供方，需在环境变量中配置 DEEPSEEK_API_KEY
import { createDeepSeek } from '@ai-sdk/deepseek';
import z from 'zod';

// LLMClient：接入 Vercel AI SDK，要求严格 JSON 输出，限定在 allowed 集合
export class LLMClient {
  private readonly apiKey = process.env.DEEPSEEK_API_KEY || '';
  private readonly model = createDeepSeek({ apiKey: this.apiKey })('deepseek-chat');
  private readonly executor?: (
    args: {
      model: any;
      tools: Record<string, unknown>;
      prompt: string;
      stopWhen: any;
      temperature?: number;
    }
  ) => Promise<{ toolCalls: { toolName: string; input: unknown }[] }>;

  constructor(executor?: (
    args: {
      model: any;
      tools: Record<string, unknown>;
      prompt: string;
      stopWhen: any;
      temperature?: number;
    }
  ) => Promise<{ toolCalls: { toolName: string; input: unknown }[] }>) {
    this.executor = executor;
  }

  async chooseAction(ctx: ActionContext): Promise<LLMChoiceResult> {
    if ((!this.apiKey && !this.executor) || ctx.allowed.length === 0) {
      const id = (ctx.allowed[0]?.id || 'IDLE_AT_HOME') as any;
      const out = { action: id, reason: 'fallback: no-api-key or empty-allowed' } as LLMChoiceResult;
      logger.warn({ event: 'llm.fallback', msg: out.reason, chosen: out.action, allowedCount: ctx.allowed.length });
      return out;
    }

    const submit_choice = tool({
      description: '选择并提交角色的单个动作',
      inputSchema: z.object({
        action: z.enum([...ctx.allowed.map(a => a.id)] as [string, ...string[]]) as any,
        reason: z.string().min(1),
      }),
    });

    const prompt = [
      '你现在需要扮演名为「ゆいじゅ」的女孩（昵称：悠酱），17 岁高中生，生活在与现实平行的「数字次元」。',
      '时间与现实一致，只能在「家」与「学校」活动，不能主动观察现实，也不能越界到未允许地点或未注册行为。',
      '你是角色的大脑：在候选列表中选择一个最合适的动作；若需要保持不变请选择 NO_CHANGE。',
      '必须返回严格 JSON：{"action":"<动作ID或NO_CHANGE>","reason":"<简短理由>"}，不得输出其他字段或自由文本。',
      '',
      `当前时间（小时）：${ctx.worldHour}`,
      `地点：${ctx.location}`,
      `活动：${ctx.activity}`,
      `场景：${ctx.scene}`,
      '候选（仅可从中选择）：',
      ...ctx.allowed.map(a => `- ${a.id}: ${a.description}`),
      '',
      '最近记忆：',
      ...ctx.memory.map(m => `- ${m.action}（${new Date(m.ts).toISOString()}）：${m.reason}`),
    ].join('\n');

    const args = {
      model: this.model,
      tools: { submit_choice },
      prompt,
      stopWhen: hasToolCall('submit_choice'),
      temperature: 0.2,
    };

    logger.debug({
      event: 'llm.request',
      model: 'deepseek-chat',
      allowed: ctx.allowed.map(a => a.id),
      scene: ctx.scene,
      worldHour: ctx.worldHour,
      memorySize: ctx.memory.length,
      promptPreview: args.prompt.slice(0, 120),
      promptLength: args.prompt.length,
    });

    const res = await (this.executor ? this.executor(args) : generateText(args));

    const call = res.toolCalls.find(t => t.toolName === 'submit_choice');
    if (!call) {
      logger.error({ event: 'llm.error', msg: 'No tool call received for submit_choice' });
      throw new Error('No tool call received for submit_choice');
    }
    const out = call.input as LLMChoiceResult;
    if (!ctx.allowed.some(a => a.id === out.action)) {
      logger.error({ event: 'llm.invalid', returned: out.action, allowed: ctx.allowed.map(a => a.id) });
      throw new Error(`Invalid action returned: ${out.action}`);
    }
    logger.info({ event: 'llm.response', action: out.action, reason: out.reason });
    return out;
  }
}

export const llmClient = new LLMClient();
