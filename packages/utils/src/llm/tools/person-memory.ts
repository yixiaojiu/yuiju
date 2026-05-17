import { tool } from "ai";
import { z } from "zod";
import { getPersonMemory, listPersonMemories } from "../../memory";

export const listPersonMemoriesTool = tool({
  description:
    "分页列出当前已经存在人物记忆文件的人物目录，包含 personId 和聊天平台当前昵称 nickname。结果按用户发言热度从高到低排序，需要更多结果时继续传入下一页 page。",
  inputSchema: z.object({
    page: z.number().int().min(1).optional().describe("页码，从 1 开始。"),
  }),
  execute: async ({ page }) => {
    const result = await listPersonMemories(page);
    return result;
  },
});

export const getPersonMemoryTool = tool({
  description:
    "按 personIds 批量读取朋友的记忆，结果包含聊天平台当前昵称 nickname 和长期记忆 sections。使用这个工具前要先调用 listPersonMemoriesTool，获取 personId。",
  inputSchema: z.object({
    personIds: z.array(z.string().min(1)).min(1),
  }),
  execute: async ({ personIds }) => {
    const items = [];

    for (const personId of personIds) {
      items.push({
        personId,
        memory: await getPersonMemory(personId),
      });
    }

    return {
      items,
    };
  },
});
