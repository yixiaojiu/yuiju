import { type Tool } from 'ai';
import { z } from 'zod';
import MemoryClient from 'mem0ai';
import { config } from '@/config';

const mem0Client = new MemoryClient({ apiKey: config.mem0.apiKey });

export const memorySearchTool: Tool = {
  name: 'memory_tools',
  description: '通过向量查询，搜索用户相关记忆',
  inputSchema: z.object({
    query: z.string().describe('搜索内容，用于查找相关记忆'),
    userName: z.string().describe('用户名，指定要搜索的用户记忆'),
  }),
  execute: async ({ query, userName }) => {
    console.log('执行 memory_tools 工具，查询：', query, '用户：', userName);
    const memoryList = await mem0Client.search(query, {
      user_id: userName,
      top_k: 5,
    });
    if (memoryList.length > 0) {
      const memoryContents = memoryList
        ?.filter(mem => mem.score && mem.score > 0.7)
        .map(mem => ({
          memory: mem.memory,
          time: mem.created_at?.toLocaleString(),
        }));
      console.log('搜索到相关记忆：', memoryContents);
      return memoryContents;
    }

    return [];
  },
};
