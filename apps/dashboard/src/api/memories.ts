import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExperienceDocument } from "@yuiju/shared/dashboard/types";
import { mongoCollectionName } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { get_data_dir } from "@yuiju/shared/paths/data";
import dayjs from "dayjs";
import { Hono } from "hono";
import { z } from "zod";
import { getDeployment } from "@/lib/deployment";

export type PersonProfile = {
  platform: string;
  userId: string;
  name: string;
  facts: string;
  impressions: string;
};

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
            characterId: deployment.characterId,
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
    const memory = await (await getMongoDatabase(deployment.source))
      .collection<ExperienceDocument>(mongoCollectionName("character_memories"))
      .findOne(
        { characterId: deployment.characterId, id: c.req.param("id") },
        { projection: { _id: 0 } },
      );
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
    const root = join(
      await get_data_dir(),
      "characters",
      encodeURIComponent(deployment.characterId),
      "memory",
      "people",
    );
    const people: PersonProfile[] = [];
    for (const platform of await readdir(root, { withFileTypes: true })) {
      if (!platform.isDirectory()) {
        continue;
      }
      for (const file of await readdir(join(root, platform.name), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(".json")) {
          people.push(JSON.parse(await readFile(join(root, platform.name, file.name), "utf8")));
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
    const path = join(
      await get_data_dir(),
      "characters",
      encodeURIComponent(deployment.characterId),
      "memory",
      "self-cognition.json",
    );
    const { text, updatedAt } = JSON.parse(await readFile(path, "utf8"));
    return c.json({ text, updatedAt });
  });
