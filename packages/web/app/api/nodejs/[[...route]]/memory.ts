import { readFile, writeFile } from "node:fs/promises";
import {
  EMPTY_PERSON_MEMORY_SECTION,
  getPersonMemory,
  getPersonMemoryFilePath,
  PERSON_MEMORY_SECTION_KEYS,
  parsePersonMemoryJson,
} from "@yuiju/utils";
import { Hono } from "hono";
import { rejectPublicRequest } from "./public-guard";

export const memoryRoute = new Hono();

const createMemoryTemplate = (personId: string) => {
  return {
    personId,
    lastUpdatedAt: new Date().toISOString(),
    sections: Object.fromEntries(
      PERSON_MEMORY_SECTION_KEYS.map((section) => [section, EMPTY_PERSON_MEMORY_SECTION]),
    ),
  };
};

memoryRoute.use("*", async (context, next) => {
  const blocked = rejectPublicRequest(context);
  if (blocked) {
    return blocked;
  }
  await next();
});

memoryRoute.get("/file", async (context) => {
  const personId = context.req.query("personId")?.trim() ?? "";
  if (!personId) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "personId is required",
      },
      400,
    );
  }

  const found = await getPersonMemory(personId);
  if (!found) {
    const template = createMemoryTemplate(personId);
    return context.json({
      code: 0,
      data: {
        personId,
        exists: false,
        content: `${JSON.stringify(template, null, 2)}\n`,
      },
      message: "ok",
    });
  }

  const filePath = await getPersonMemoryFilePath(personId);
  const content = await readFile(filePath, "utf8");
  return context.json({
    code: 0,
    data: {
      personId,
      exists: true,
      content,
    },
    message: "ok",
  });
});

memoryRoute.post("/file", async (context) => {
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

  const payload = body as { personId?: unknown; content?: unknown };
  const personId = typeof payload.personId === "string" ? payload.personId.trim() : "";
  const content = typeof payload.content === "string" ? payload.content : "";

  if (!personId) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "personId is required",
      },
      400,
    );
  }

  if (!content.trim()) {
    return context.json(
      {
        code: 400,
        data: null,
        message: "content is required",
      },
      400,
    );
  }

  try {
    parsePersonMemoryJson({ content, personId });
  } catch (error) {
    return context.json(
      {
        code: 400,
        data: null,
        message: error instanceof Error ? error.message : "invalid memory content",
      },
      400,
    );
  }

  const filePath = await getPersonMemoryFilePath(personId);
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

  return context.json({
    code: 0,
    data: { personId },
    message: "ok",
  });
});
