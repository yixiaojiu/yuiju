import { load_config } from "@yuiju/shared/config/load";
import { type CalendarQueryResult, calendarQuerySchema } from "@yuiju/shared/world/calendar";
import type { WorldResult } from "@yuiju/shared/world/protocol";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getDeployment } from "@/lib/deployment";
import { getQueryCharacter } from "../character-query";

export type CalendarResponse = CalendarQueryResult & { timezone: string };
export const calendarApi = new Hono().get("/", async (context) => {
  const deployment = await getDeployment();
  if (deployment.publicDeployment) {
    throw new HTTPException(403, { message: "公开部署不开放日程" });
  }
  const character = getQueryCharacter(context.req.query("characterId"), deployment.characters);
  let input: unknown;
  try {
    input = JSON.parse(context.req.query("query")!);
  } catch {
    throw new HTTPException(400, { message: "日历查询参数必须是 JSON" });
  }
  const parsed = calendarQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  const config = await load_config();
  const response = await fetch(new URL("/calendar/query", config.app!.world_simulator!.base_url!), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId: character.id, query: parsed.data }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const result = (await response.json()) as WorldResult<CalendarQueryResult>;
  if (!result.ok) {
    throw new HTTPException(result.code === "world_unavailable" ? 503 : 400, {
      message: result.message,
    });
  }
  return context.json({
    ...result.value,
    timezone: deployment.timezone,
  } satisfies CalendarResponse);
});
