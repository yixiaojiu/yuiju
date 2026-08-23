import { z } from "zod";

/**
 * `currentPlan` / `nextPlan` 不能写成 `.optional()`：那样字段只出现在 JSON Schema 的
 * `properties` 里、不进 `required`，而 OpenAI strict 模式要求每层 object 的所有属性都
 * 必须列入同层 `required`，请求会在生成前被拒绝。strict 下表达「可选」的唯一方式是
 * required + nullable，即键始终存在、值允许为 null。
 *
 * nullable 之后补一次 transform 把 null 归一化回 undefined，于是下发给 provider 的是
 * 合规的 `anyOf: [..., {"type": "null"}]`，而 `z.infer` 推导出的仍是 `string | undefined`，
 * 业务侧拿到的对象形状不变。
 */
export const agentPlanChangeSchema = z.object({
  scope: z.enum(["longTerm", "shortTerm"]).describe("计划范围。"),
  changeType: z.enum(["created", "updated", "abandoned", "completed"]).describe("计划变更类型。"),
  currentPlan: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("当前已有计划。updated / abandoned / completed 时按规则填写，不适用时填 null。"),
  nextPlan: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("变更后的新计划。created / updated 时按规则填写，不适用时填 null。"),
  reason: z.string().describe("这次计划变更的理由。"),
});

/**
 * 工具入参用的宽松变体。
 *
 * `currentPlan` / `nextPlan` 原本是 `.optional()`，结构化输出和两个工具入参三处
 * 共用，都允许缺省。为满足 strict 只需要收紧结构化输出那一处，工具入参保持原样。
 *
 * 相比改造前只是多接受一种输入：缺省和显式 null 都归一化成 undefined，`required`
 * 与改造前完全一致。
 */
export const agentPlanChangeToolSchema = agentPlanChangeSchema.partial({
  currentPlan: true,
  nextPlan: true,
});
