import {
  changeCharacterMoney,
  emitMemoryEpisode,
  initCharacterStateData,
  isDev,
  SUBJECT_NAME,
  setCharacterMoney,
  syncCharacterMoney,
} from "@yuiju/utils";
import { Hono } from "hono";
import { rejectPublicRequest } from "./public-guard";

const parseAmount = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
};

export const stateRoute = new Hono();

stateRoute.use("*", async (context, next) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }
  await next();
});

stateRoute.post("/allowance", async (context) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json(
      {
        code: 400,
        data: null,
        message: "invalid JSON body",
      },
      400,
    );
  }

  const payload = body as { amount?: unknown; reason?: unknown; mode?: unknown };
  let mode: "add" | "set" = "add";
  if (payload.mode !== undefined) {
    if (payload.mode === "add" || payload.mode === "set") {
      mode = payload.mode;
    } else {
      return context.json(
        {
          code: 400,
          data: null,
          message: "mode must be add or set",
        },
        400,
      );
    }
  }
  const amount = parseAmount(payload.amount);

  if (amount === null) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "amount must be an integer number",
      },
      400,
    );
  }

  if (mode === "add" && amount <= 0) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "amount must be > 0 when mode=add",
      },
      400,
    );
  }

  if (mode === "set" && amount < 0) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "amount must be >= 0 when mode=set",
      },
      400,
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

  await initCharacterStateData();

  let previousMoney = 0;
  let currentMoney = 0;
  let delta = 0;

  if (mode === "add") {
    const moneyChange = await changeCharacterMoney(amount);
    previousMoney = moneyChange.previousMoney;
    currentMoney = moneyChange.currentMoney;
    delta = moneyChange.delta;
  } else {
    const moneyChange = await setCharacterMoney(amount);
    previousMoney = moneyChange.previousMoney;
    currentMoney = moneyChange.currentMoney;
    delta = moneyChange.delta;
  }

  const descriptionBase =
    mode === "add"
      ? `翊小久给金币：+${amount}（${previousMoney} -> ${currentMoney}）`
      : `翊小久设置金币：${previousMoney} -> ${currentMoney}`;

  try {
    await emitMemoryEpisode({
      source: "system",
      type: "system",
      subject: SUBJECT_NAME,
      happenedAt: new Date(),
      summaryText: reason ? `${descriptionBase}；原因：${reason}` : descriptionBase,
      isDev: isDev(),
      payload: {
        eventName: "金币变动",
        mode,
        previousMoney,
        currentMoney,
        delta,
        reason: reason || undefined,
      },
    });
    await syncCharacterMoney(currentMoney);
  } catch (err) {
    try {
      if (mode === "add") {
        await changeCharacterMoney(-amount);
      } else {
        await setCharacterMoney(previousMoney);
      }
      await syncCharacterMoney(previousMoney);
    } catch {}

    throw err;
  }

  return context.json({
    code: 0,
    data: {
      previousMoney,
      currentMoney,
      delta,
      mode,
    },
    message: "ok",
  });
});
