import { tool } from "ai";
import { z } from "zod";

// TODO：接入表情资源、选择与发送后才加入 Planner 的可调用工具集。
export const sendSticker = tool({
  description: "你想用表情回应当前交流。",
  inputSchema: z.object({ intention: z.string().min(1).describe("你想表达的意思或感受。") }),
});
