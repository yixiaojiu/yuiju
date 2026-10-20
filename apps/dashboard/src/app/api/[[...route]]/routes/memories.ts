import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExperienceDocument } from "@yuiju/shared/dashboard/types";
import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { get_data_dir } from "@yuiju/shared/utils/path";
import dayjs from "dayjs";
import { Hono } from "hono";
import { z } from "zod";
import { getDeployment } from "@/lib/deployment";
import { getQueryCharacter } from "../character-query";

/** 文件身份取自目录和文件名，不随用户编辑 JSON 内的字段改变。 */
export type PersonMemoryFile = {
  platform: string;
  userId: string;
  name: string;
  content: string;
};

function encodeMemoryComponent(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

export type ExperienceSummary = Pick<
  ExperienceDocument,
  "id" | "grain" | "startDate" | "endDate"
> & {
  excerpt: string;
};
export type ExperiencesResponse = {
  memories: ExperienceSummary[];
  page: number;
  pageSize: number;
  total: number;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => dayjs(date).format("YYYY-MM-DD") === date);
const experienceQuerySchema = z
  .object({
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    grain: z.enum(["day", "week", "month", "year"]).optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive(),
  })
  .refine((query) => !query.startDate || !query.endDate || query.startDate <= query.endDate);

export const memoriesApi = new Hono()
  .get("/experiences", async (c) => {
    const parsed = experienceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "日期范围、记忆周期或页码无效" }, 400);
    }
    const { startDate, endDate, grain, keyword, page } = parsed.data;
    const deployment = await getDeployment();
    const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
    const collection = (await getMongoDatabase(deployment.source)).collection<ExperienceDocument>(
      mongoCollectionName("character_memories"),
    );
    const pageSize = 20;
    const search = keyword?.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 周、月、年记忆按覆盖日期与筛选范围相交查询，列表只返回摘要。
    const [result] = await collection
      .aggregate<{ memories: ExperienceSummary[]; count: { total: number }[] }>([
        {
          $match: {
            characterId: character.id,
            ...(grain ? { grain } : {}),
            ...(startDate ? { endDate: { $gte: startDate } } : {}),
            ...(endDate ? { startDate: { $lte: endDate } } : {}),
            ...(search ? { text: { $regex: search, $options: "i" } } : {}),
          },
        },
        {
          $facet: {
            count: [{ $count: "total" }],
            memories: [
              { $sort: { startDate: -1, id: 1 } },
              { $skip: (page - 1) * pageSize },
              { $limit: pageSize },
              {
                $project: {
                  _id: 0,
                  id: 1,
                  grain: 1,
                  startDate: 1,
                  endDate: 1,
                  excerpt: { $substrCP: ["$text", 0, 200] },
                },
              },
            ],
          },
        },
      ])
      .toArray();
    return c.json({
      memories: result.memories,
      page,
      pageSize,
      total: result.count.length ? result.count[0].total : 0,
    } satisfies ExperiencesResponse);
  })
  .get("/experiences/:id", async (c) => {
    const deployment = await getDeployment();
    const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
    const memory = await (await getMongoDatabase(deployment.source))
      .collection<ExperienceDocument>(mongoCollectionName("character_memories"))
      .findOne({ characterId: character.id, id: c.req.param("id") }, { projection: { _id: 0 } });
    if (!memory) {
      return c.json({ error: "记忆不存在" }, 404);
    }
    return c.json(memory);
  })
  .get("/people", async (c) => {
    const deployment = await getDeployment();
    if (deployment.publicDeployment) {
      return c.notFound();
    }
    const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
    const root = join(
      await get_data_dir(),
      "characters",
      encodeMemoryComponent(character.id),
      "memory",
      "people",
    );
    const people: PersonMemoryFile[] = [];
    for (const platform of await readdir(root, { withFileTypes: true })) {
      if (!platform.isDirectory()) {
        continue;
      }
      for (const file of await readdir(join(root, platform.name), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(".json")) {
          const content = await readFile(join(root, platform.name, file.name), "utf8");
          const value = JSON.parse(content);
          people.push({
            platform: decodeURIComponent(platform.name),
            userId: decodeURIComponent(file.name.slice(0, -5)),
            // 文件编辑不限制 JSON 结构；有名称时用于列表展示，否则只显示文件身份。
            name: typeof value?.name === "string" ? value.name : "",
            content,
          });
        }
      }
    }
    return c.json({ people: people.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) });
  })
  .get("/self-cognition", async (c) => {
    const deployment = await getDeployment();
    if (deployment.publicDeployment) {
      return c.notFound();
    }
    const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
    const path = join(
      await get_data_dir(),
      "characters",
      encodeMemoryComponent(character.id),
      "memory",
      "self-cognition.json",
    );
    const { text } = JSON.parse(await readFile(path, "utf8"));
    return c.json({ text });
  })
  .put("/:kind", async (c) => {
    const deployment = await getDeployment();
    if (deployment.publicDeployment) {
      return c.notFound();
    }
    const kind = c.req.param("kind");
    if (kind !== "people" && kind !== "self-cognition") {
      return c.notFound();
    }
    const character = getQueryCharacter(c.req.query("characterId"), deployment.characters);
    const root = join(
      await get_data_dir(),
      "characters",
      encodeMemoryComponent(character.id),
      "memory",
    );
    let path = join(root, "self-cognition.json");
    if (kind === "people") {
      const platform = c.req.query("platform");
      const userId = c.req.query("userId");
      if (!platform || !userId) {
        return c.json({ error: "请选择人物文件" }, 400);
      }
      path = join(
        root,
        "people",
        encodeMemoryComponent(platform),
        `${encodeMemoryComponent(userId)}.json`,
      );
    }
    let content = await c.req.text();
    if (kind === "people") {
      try {
        JSON.parse(content);
      } catch {
        return c.json({ error: "JSON 格式错误，未保存" }, 400);
      }
    } else {
      // 自我认知只编辑正文；读取保存时的文件，其余字段原样保留。
      const cognition = JSON.parse(await readFile(path, "utf8"));
      cognition.text = content;
      content = JSON.stringify(cognition, null, 2);
    }
    // 只覆盖已有文件；人物画像保留用户输入的 JSON 格式。
    const file = await open(path, "r+");
    try {
      await file.writeFile(content, "utf8");
      await file.truncate(Buffer.byteLength(content, "utf8"));
    } finally {
      await file.close();
    }
    return c.json({ saved: true });
  });
