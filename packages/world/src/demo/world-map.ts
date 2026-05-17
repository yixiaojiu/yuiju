import { queryStaticGuideTool, strongModel } from "@yuiju/utils";
import { generateText, stepCountIs } from "ai";

/**
 * 只验证一个最小问题，观察模型是否会调用 queryStaticGuideTool，
 * 并基于返回的 DSL 推导出从神社到学校的路径。
 */
const QUESTION = "从神社怎么去学校？";

export async function main() {
  const prompt = [
    "请先调用 queryStaticGuide 查询 worldMap 条目，再回答问题。",
    "回答时请直接给出从起点到终点的路径。",
    "",
    "问题：",
    QUESTION,
  ].join("\n");

  const result = await generateText({
    model: strongModel,
    tools: {
      queryStaticGuide: queryStaticGuideTool,
    },
    prompt,
    stopWhen: stepCountIs(10),
  });

  console.log("\n=== QUESTION ===\n");
  console.log(QUESTION);
  console.log("\n=== TOOL CALLS ===\n");
  console.log(JSON.stringify(result.toolCalls, null, 2));
  console.log("\n=== TOOL RESULTS ===\n");
  console.log(JSON.stringify(result.toolResults, null, 2));
  console.log("\n=== LLM ANSWER ===\n");
  console.log(result.text);
}
