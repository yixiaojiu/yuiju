import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getLangfuseTelemetry } from "../llm/langfuse-telemetry";
import { getFlashModel } from "../llm/models";
import { createToolCallLoggingHooks } from "../llm/tool-call-logger";
import { diarySearchTool, semanticDiarySearchTool } from "../llm/tools/memory-search";
import { getPersonMemoryTool, listPersonMemoriesTool } from "../llm/tools/person-memory";
import { queryStaticGuideTool } from "../llm/tools/query-static-guide";
import { memoryRetrievalSystemPrompt } from "../prompt/memory-retrieval";
import {
  buildBatchChatMemoryRetrievalQuery,
  buildChatMemoryRetrievalQuery,
} from "../prompt/message";
import { readCoreMemory } from "./core-memory";

export interface MemoryRetrievalInput {
  query: string;
  abortSignal: AbortSignal;
  semanticDiarySearchCallLimit?: number;
}

export interface ChatMemoryRetrievalToolInput {
  summary?: string;
  historyJson: string;
  abortSignal: AbortSignal;
  semanticDiarySearchCallLimit?: number;
}

export interface BatchChatMemoryRetrievalToolInput {
  summary?: string;
  historyJson: string;
  abortSignal: AbortSignal;
}

export function createChatMemoryRetrievalTool(input: ChatMemoryRetrievalToolInput) {
  let resultPromise: Promise<string> | null = null;

  return {
    tool: tool({
      description:
        "当回复判断或内容依赖最近会话没有提供的过去经历、人物关系、偏好、约定或静态设定时，检索相关记忆与事实。",
      inputSchema: z.object({}),
      execute: () => {
        resultPromise ??= (async () => {
          const coreMemory = await readCoreMemory();

          return retrieveMemory({
            query: buildChatMemoryRetrievalQuery({
              summary: input.summary,
              historyJson: input.historyJson,
              memory: coreMemory ?? undefined,
            }),
            abortSignal: input.abortSignal,
            semanticDiarySearchCallLimit: input.semanticDiarySearchCallLimit,
          });
        })();

        return resultPromise;
      },
    }),
    hasBeenCalled: () => resultPromise !== null,
  };
}

export function createBatchChatMemoryRetrievalTool(input: BatchChatMemoryRetrievalToolInput) {
  return tool({
    description:
      "当回复判断或内容依赖不同的过去经历、人物关系、偏好、约定或静态设定时，按明确目标检索相关记忆与事实；可以围绕不同目标多次调用。",
    inputSchema: z.object({
      query: z.string().min(1).describe("本次要检索的单个明确目标"),
    }),
    execute: async ({ query }) => {
      const coreMemory = await readCoreMemory();

      return retrieveMemory({
        query: buildBatchChatMemoryRetrievalQuery({
          query,
          summary: input.summary,
          historyJson: input.historyJson,
          memory: coreMemory ?? undefined,
        }),
        abortSignal: input.abortSignal,
      });
    },
  });
}

export async function retrieveMemory(input: MemoryRetrievalInput): Promise<string> {
  let semanticDiarySearchCallCount = 0;
  const tools = {
    diarySearch: diarySearchTool,
    semanticDiarySearch: tool({
      description: semanticDiarySearchTool.description,
      inputSchema: semanticDiarySearchTool.inputSchema,
      execute: async (toolInput, options) => {
        if (
          input.semanticDiarySearchCallLimit !== undefined &&
          semanticDiarySearchCallCount >= input.semanticDiarySearchCallLimit
        ) {
          return "本次语义日记检索已达到调用上限，请使用已有查询结果。";
        }

        semanticDiarySearchCallCount += 1;
        return semanticDiarySearchTool.execute(toolInput, options);
      },
    }),
    listPersonMemories: listPersonMemoriesTool,
    getPersonMemory: getPersonMemoryTool,
    queryStaticGuide: queryStaticGuideTool,
  };
  const toolNames = Object.keys(tools) as Array<keyof typeof tools>;

  const result = await generateText({
    model: getFlashModel(),
    providerOptions: {
      flash: {
        enable_thinking: false,
      },
    },
    instructions: memoryRetrievalSystemPrompt,
    prompt: input.query,
    tools,
    prepareStep: () => {
      if (
        input.semanticDiarySearchCallLimit === undefined ||
        semanticDiarySearchCallCount < input.semanticDiarySearchCallLimit
      ) {
        return;
      }

      return {
        activeTools: toolNames.filter((toolName) => toolName !== "semanticDiarySearch"),
      };
    },
    stopWhen: stepCountIs(20),
    abortSignal: input.abortSignal,
    telemetry: getLangfuseTelemetry(),
    ...createToolCallLoggingHooks({
      scene: "memory.retrieval",
    }),
  });

  return result.text.trim();
}
