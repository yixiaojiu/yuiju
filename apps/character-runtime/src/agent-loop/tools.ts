import { randomUUID } from "node:crypto";
import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { logger } from "@yuiju/shared/logger/logger";
import {
  type ActivityView,
  type ExecuteActionResult,
  executeActionSchema,
  type InspectWorldResult,
  inspectWorldSchema,
  type WorldResult,
} from "@yuiju/shared/world/protocol";
import { tool } from "ai";
import { z } from "zod";
import { describeEmotion, type Emotion } from "../emotion/emotion";
import { recordExperience } from "../memory/experiences";
import { formatPeople, readPeople } from "../memory/people";
import { recallExperiences, recallSchema } from "../memory/recall";
import { readSelfCognition } from "../memory/self-cognition";
import {
  formatPlans,
  parsePlanTimes,
  type planInputSchema,
  planToolSchema,
  readPlans,
  savePlan,
} from "../plan/plan";
import type { WorldClient } from "../world/client";
import { formatWorldView } from "../world/tools";
import { type AgentAction, appendAgentAction, saveAgentAction } from "./storage";

const updatePlanSchema = planToolSchema.extend({ planId: z.string().min(1) });
const feelingSchema = z.strictObject({
  feeling: z.string().min(1).describe("你对实际发生的某件事的感受，用自然语言表达"),
});
const personSchema = z.strictObject({
  platform: z.literal("QQ").describe("你要查询的人的平台，目前支持 QQ。"),
  userId: z.string().min(1).describe("你要查询的人的 QQ 号。"),
});
const shareSchema = z.strictObject({
  intention: z
    .string()
    .min(1)
    .describe("你想向各个 QQ 群分享的自己的经历或表达意图；不包含任何群的私人内容"),
});

const conversationResponseSchema = z.strictObject({
  eventId: z.string().min(1).describe("你要回应的群聊事件 ID，来自输入中的事件 ID，不是消息 id"),
  content: z
    .string()
    .min(1)
    .describe("你对这件事的决定、进展或需要补充的信息；区分打算与已发生的结果"),
});

/** 工具说明与 schema 供执行和上下文压缩共用；execute 在绑定角色时补充。 */
export const agentTools = {
  inspect_character: tool({
    description: "你可以按需了解自己的情绪与感受、近期对生活的看法。",
    inputSchema: z.strictObject({
      type: z
        .enum(["emotion", "self_cognition"])
        .describe("emotion：情绪与已记录的感受；self_cognition：近期生活的主观看法"),
    }),
  }),
  share: tool({
    description:
      "你可以把分享意图广播给所有已连接的 QQ 群，各群独立决定是否、何时以及如何表达。提交不代表已经发送。",
    inputSchema: shareSchema,
  }),
  respond_conversation: tool({
    description:
      "你将决定、进展或问题交回来源群的聊天规划。程序根据事件 ID 定位群聊，提交不代表已发出群消息，也不等待对方处理。",
    inputSchema: conversationResponseSchema,
  }),
  recall: tool({
    description:
      "你可以回忆已经整理的生活经历。search 按语义搜索片段，read 按日期读取完整记忆；日期为 YYYY-MM-DD，查询遵守遗忘范围。",
    inputSchema: recallSchema,
  }),
  read_person: tool({
    description: "你可以了解对某个人的已有认识；手动关联的平台身份会联合读取。",
    inputSchema: personSchema,
  }),
  express_feeling: tool({
    description: "你可以提交对某件事的感受，情绪稍后更新，不会重新触发思考。",
    inputSchema: feelingSchema,
  }),
  inspect_world: tool({
    description:
      "你可以查询当前状态、熟悉地点、方位关系或行动说明。action 查询返回执行条件、耗时、payload 的参数 schema 与可选内容；条件反映实际状态，指定查询地点不会使你到达那里。地点支持准确 ID、完整名称和名称关键词，多个匹配会返回候选；places 可用于检索地点及其准确 ID。",
    // 模型接收根对象参数；pipe 保留各查询类型的必填字段与严格字段约束。
    inputSchema: z
      .strictObject({
        type: z
          .enum(["current", "places", "place", "relation", "action"])
          .describe(
            "你查询 current 时只传 type；places 可选 query，不传则列出熟悉地点；place 传 place；relation 传 fromPlace 和 toPlace；action 传 actionId，可选 place 和 payload",
          ),
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("你检索地点时使用的关键词，匹配 ID、名称或地点描述中的文字"),
        place: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("你查询的地点：准确 ID、完整名称或名称关键词；查询行动时不传则使用当前地点"),
        fromPlace: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("你查询关系的起点：准确 ID、完整名称或名称关键词"),
        toPlace: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("你查询关系的终点：准确 ID、完整名称或名称关键词"),
        actionId: z.string().min(1).optional().describe("你从世界查询结果中获得的准确行动 ID"),
        payload: z
          .string()
          .optional()
          .describe(
            "你要检查的行动参数，按该行动的参数 schema 编写为 JSON 字符串；不传则查询 schema 与选项",
          ),
      })
      .pipe(inspectWorldSchema),
  }),
  execute_action: tool({
    description:
      "你向世界提交行动选择，payload 是按 inspect_world 的 action 查询所提供 schema 填写的 JSON 字符串。世界检查实际条件并执行，返回拒绝原因或执行结果。持续活动返回开始信息与预计结束时间，完成结果由后续世界事件提供；进行中会占用你的世界活动，工具返回不表示活动已经结束。",
    inputSchema: executeActionSchema,
  }),
  read_plans: tool({
    description: "你可以查看自己的安排与进展。",
    inputSchema: z.strictObject({}),
  }),
  create_plan: tool({
    description: "你可以记录自己接受的打算及下次关注时间。",
    inputSchema: planToolSchema,
  }),
  update_plan: tool({
    description: "你可以更新已有安排、进展或取消。提交修改后的完整计划。",
    inputSchema: updatePlanSchema,
  }),
};

export const agentToolDescription = JSON.stringify(
  Object.fromEntries(
    Object.entries(agentTools).map(([name, definition]) => [
      name,
      {
        description: definition.description,
        schema: z.toJSONSchema(definition.inputSchema as z.ZodType, { io: "input" }),
      },
    ]),
  ),
);

export type AgentToolContext = {
  characterId: string;
  world: WorldClient;
  emotion: Emotion;
  share: (requestId: string, text: string, occurredAt: number) => Promise<string>;
  respondConversation: (
    requestId: string,
    eventId: string,
    content: string,
    occurredAt: number,
  ) => Promise<string>;
  /** 世界确认的活动及时影响聊天权限；不等待本轮思考全部结束。 */
  observeActivity: (activity: ActivityView | null) => Promise<void>;
  /** 查询并同步当前活动；返回 null 表示成功，否则将未确认原因交给模型。 */
  syncWorldActivity: () => Promise<string | null>;
};

/** SDK 调度工具；查询直接执行，有副作用的调用按角色本轮顺序记录并执行。 */
export function createAgentTools(
  context: AgentToolContext,
  roundId: string,
  signal: AbortSignal,
  onFailure: (error: unknown) => void,
) {
  // SDK 同一步可并行调用多个工具；实际修改串行，确保未确认的操作不会被后续修改覆盖。
  let actionQueue = Promise.resolve();
  async function executeAction(name: AgentAction["name"], input: unknown): Promise<string> {
    const previous = actionQueue;
    let release!: () => void;
    actionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      signal.throwIfAborted();
      const action: AgentAction = { id: randomUUID(), name, input, createdAt: Date.now() };
      const index = await appendAgentAction(context.characterId, roundId, action);
      logger.silly("e2e.tool.action.recorded", {
        characterId: context.characterId,
        roundId,
        requestId: action.id,
        name,
        input,
      });
      signal.throwIfAborted();
      action.result = await executeAgentAction(context, action, false);
      await saveAgentAction(context.characterId, roundId, index, action);
      logger.silly("e2e.tool.action.committed", {
        characterId: context.characterId,
        roundId,
        requestId: action.id,
        result: action.result,
      });
      return action.result;
    } catch (error) {
      // SDK 会把 execute 异常转为 tool-error；持久化未确认时必须同时中止整轮。
      onFailure(error);
      throw error;
    } finally {
      release();
    }
  }

  return {
    inspect_character: tool({
      ...agentTools.inspect_character,
      async execute({ type }) {
        const timezone = (await load_config()).app!.timezone!;
        const queriedAt = `查询时间：${formatLlmDateTime(Date.now(), timezone)}`;
        if (type === "emotion") {
          const emotion = await context.emotion.read();
          return [
            queriedAt,
            `当前情绪：${describeEmotion(emotion)}`,
            ...emotion.feelings.map(
              (feeling) =>
                `你记录的感受（${formatLlmDateTime(feeling.occurredAt, timezone)}）：${feeling.content}`,
            ),
          ].join("\n");
        }
        const cognition = await readSelfCognition(context.characterId);
        return [
          queriedAt,
          cognition.updatedAt === null
            ? "这是你原有的生活认识。"
            : `整理时间：${formatLlmDateTime(cognition.updatedAt, timezone)}`,
          `你对近期生活的主观看法，不等同于客观事实：\n${cognition.text}`,
        ].join("\n");
      },
    }),
    share: tool({
      ...agentTools.share,
      execute: async (input) => await executeAction("share", input),
    }),
    respond_conversation: tool({
      ...agentTools.respond_conversation,
      execute: async (input) => await executeAction("respond_conversation", input),
    }),
    express_feeling: tool({
      ...agentTools.express_feeling,
      execute: async (input) => await executeAction("express_feeling", input),
    }),
    execute_action: tool({
      ...agentTools.execute_action,
      execute: async (input) => await executeAction("execute_action", input),
    }),
    create_plan: tool({
      ...agentTools.create_plan,
      execute: async (input) => await executeAction("create_plan", input),
    }),
    update_plan: tool({
      ...agentTools.update_plan,
      execute: async (input) => await executeAction("update_plan", input),
    }),
    recall: tool({
      ...agentTools.recall,
      async execute(input) {
        try {
          return await recallExperiences(context.characterId, input);
        } catch (error) {
          logger.error("角色回忆失败", { characterId: context.characterId, error });
          return `回忆未成功：${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    read_person: tool({
      ...agentTools.read_person,
      execute: async ({ userId }) =>
        await formatPeople(await readPeople(context.characterId, { platform: "onebot", userId })),
    }),
    read_plans: tool({
      ...agentTools.read_plans,
      execute: async () => await formatPlans(await readPlans(context.characterId)),
    }),
    inspect_world: tool({
      ...agentTools.inspect_world,
      async execute(input) {
        let result: WorldResult<InspectWorldResult>;
        try {
          result = await context.world.inspect(input);
        } catch (error) {
          logger.warn("角色查询世界失败", { characterId: context.characterId, error });
          return `世界查询未成功：${error instanceof Error ? error.message : String(error)}`;
        }
        if (!result.ok) {
          return `世界查询失败（${result.code}）：\n${result.message}`;
        }
        if (result.value.type === "current") {
          await context.observeActivity(result.value.activity);
        }
        return await formatWorldView(result.value);
      },
    }),
  };
}

/** 正常执行与中断恢复共用业务入口；恢复沿用原请求标识，已保存结果的操作不再执行。 */
export async function executeAgentAction(
  context: AgentToolContext,
  call: AgentAction,
  recovering: boolean,
): Promise<string> {
  const { characterId, world } = context;
  const { id: requestId, createdAt } = call;
  if (Date.now() - createdAt >= 30 * 24 * 60 * 60_000) {
    return "这次中断的调用已超过结果保留期限，不能重放。请查询现状后重新决定。";
  }
  if (call.name === "express_feeling") {
    await context.emotion.submit(requestId, feelingSchema.parse(call.input).feeling, createdAt);
    return "已记下这份感受，情绪变化将用于之后的思考与交流。";
  }
  if (call.name === "share") {
    const input = shareSchema.parse(call.input);
    return await context.share(requestId, input.intention, createdAt);
  }
  if (call.name === "respond_conversation") {
    const input = conversationResponseSchema.parse(call.input);
    return await context.respondConversation(requestId, input.eventId, input.content, createdAt);
  }
  if (call.name === "execute_action") {
    let result: WorldResult<ExecuteActionResult>;
    try {
      result = await world.execute(executeActionSchema.parse(call.input), requestId);
    } catch (error) {
      logger.warn("角色行动请求结果未确认", { characterId, requestId, error });
      return "行动请求未取得结果，执行状态不确定。请查询现状，不要把未知结果当成未执行而重复行动。";
    }
    if (!result.ok) {
      return [
        result.message,
        ...(result.conditions ?? [])
          .filter((condition) => condition.status !== "met")
          .map((condition) => condition.description),
      ].join("\n");
    }
    const activity = result.value.status === "started" ? result.value.activity : null;
    // 恢复时返回的是旧回执；由主 loop 恢复完操作后统一同步当前活动。
    if (!recovering) {
      await context.observeActivity(activity);
    }
    const timezone = (await load_config()).app!.timezone!;
    const text = `${result.value.description}\n活动 ID：${result.value.activity.activityId}\n${activity ? `预计结束：${formatLlmDateTime(activity.endsAt, timezone)}` : "已完成"}`;
    await recordExperience(characterId, {
      id: requestId,
      occurredAt: result.value.activity.startedAt,
      source: "action",
      content: text,
      people: [],
    });
    return text;
  }
  let id = requestId;
  let input: z.infer<typeof planToolSchema>;
  if (call.name === "update_plan") {
    const { planId, ...fields } = updatePlanSchema.parse(call.input);
    id = planId;
    input = fields;
    if (!(await readPlans(characterId)).some((plan) => plan.id === id)) {
      return `计划不存在：${id}`;
    }
  } else {
    input = planToolSchema.parse(call.input);
  }
  if (
    (input.status === "completed" || input.status === "cancelled") &&
    input.attentionAt !== null
  ) {
    return "已结束的计划不能保留下次关注时间，请将 attentionAt 设为 null。";
  }
  let fields: z.infer<typeof planInputSchema>;
  try {
    fields = parsePlanTimes(input, (await load_config()).app!.timezone!);
  } catch (error) {
    return `计划未保存：${error instanceof Error ? error.message : String(error)}`;
  }
  const plan = await savePlan(characterId, id, fields, requestId, call.name === "create_plan");
  return await formatPlans([plan]);
}
