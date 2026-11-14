import { logger } from "@yuiju/shared/logger/logger";
import {
  calendarCreateSchema,
  calendarQuerySchema,
  calendarUpdateSchema,
} from "@yuiju/shared/world/calendar";
import {
  activityControlSchema,
  executeActionSchema,
  inspectWorldSchema,
} from "@yuiju/shared/world/protocol";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { z } from "zod";
import type { World } from "../world";

const inspectRequestSchema = z.strictObject({
  characterId: z.string().min(1),
  query: inspectWorldSchema,
});
const actionRequestSchema = executeActionSchema.extend({
  characterId: z.string().min(1),
  requestId: z.string().min(1),
});

async function readRequestJson(request: HonoRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HTTPException(400, { message: "请求正文必须是有效 JSON", cause: error });
    }
    throw error;
  }
}

/** HTTP 入口只负责请求校验和响应，世界规则交给 World 执行。 */
export function createWorldHttpApp(world: World) {
  const app = new Hono();
  app.post("/calendar/query", async (context) => {
    const parsed = z
      .strictObject({ characterId: z.string().min(1), query: calendarQuerySchema })
      .safeParse(await readRequestJson(context.req));
    if (!parsed.success) {
      return context.json(
        { ok: false, code: "invalid_request", message: parsed.error.message },
        400,
      );
    }
    const result = await world.queryCalendar(parsed.data.characterId, parsed.data.query);
    return context.json(result, result.ok ? 200 : 400);
  });
  app.post("/calendar/items", async (context) => {
    const parsed = z
      .strictObject({
        characterId: z.string().min(1),
        requestId: z.string().min(1),
        item: calendarCreateSchema,
      })
      .safeParse(await readRequestJson(context.req));
    if (!parsed.success) {
      return context.json(
        { ok: false, code: "invalid_request", message: parsed.error.message },
        400,
      );
    }
    const { characterId, requestId, item } = parsed.data;
    const result = await world.writeCalendar(characterId, requestId, {
      operation: "create",
      ...item,
    });
    return context.json(result, result.ok ? 200 : 400);
  });
  app.patch("/calendar/items/:itemId", async (context) => {
    const parsed = calendarUpdateSchema
      .omit({ itemId: true })
      .extend({ characterId: z.string().min(1), requestId: z.string().min(1) })
      .safeParse(await readRequestJson(context.req));
    if (!parsed.success) {
      return context.json(
        { ok: false, code: "invalid_request", message: parsed.error.message },
        400,
      );
    }
    const { characterId, requestId, ...fields } = parsed.data;
    const result = await world.writeCalendar(characterId, requestId, {
      operation: "update",
      itemId: context.req.param("itemId"),
      ...fields,
    });
    return context.json(result, result.ok ? 200 : 400);
  });
  app.post("/inspect", async (context) => {
    const parsed = inspectRequestSchema.safeParse(await readRequestJson(context.req));
    if (!parsed.success) {
      return context.json(
        { ok: false, code: "invalid_request", message: parsed.error.message },
        400,
      );
    }
    const result = world.inspect(parsed.data.characterId, parsed.data.query);
    return context.json(result, result.ok ? 200 : 400);
  });
  app.post("/actions", async (context) => {
    const parsed = actionRequestSchema.safeParse(await readRequestJson(context.req));
    if (!parsed.success) {
      return context.json(
        { ok: false, code: "invalid_request", message: parsed.error.message },
        400,
      );
    }
    const { characterId, requestId, ...input } = parsed.data;
    const result = await world.execute(characterId, requestId, input);
    return context.json(result, result.ok ? 200 : 400);
  });
  app.post("/activity-control", async (c) => {
    const parsed = z
      .object({ characterId: z.string().min(1), command: activityControlSchema })
      .safeParse(await readRequestJson(c.req));
    if (!parsed.success) {
      return c.json({ ok: false, code: "invalid_request", message: parsed.error.message }, 400);
    }
    const result = await world.controlActivity(parsed.data.characterId, parsed.data.command);
    return c.json(result, result.ok ? 200 : 400);
  });
  app.onError((error, context) => {
    if (error instanceof HTTPException) {
      return context.json(
        { ok: false, code: "invalid_request", message: error.message },
        error.status,
      );
    }
    logger.error("世界 HTTP 请求失败", { error });
    return context.json(
      { ok: false, code: "world_unavailable", message: "世界请求失败，请稍后重新查询状态" },
      503,
    );
  });

  return app;
}
