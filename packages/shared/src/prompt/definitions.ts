import { yunoPersona } from "./character/yuno";
import { multimodalPrompt } from "./conversation/multimodal";
import { plannerPrompt } from "./conversation/planner";
import { plannerCompressionPrompt } from "./conversation/planner-compression";
import { replyerPrompt } from "./conversation/replyer";
import { replyerCompressionPrompt } from "./conversation/replyer-compression";
import type { PromptTemplate } from "./template";

export const promptDefinitions: readonly PromptTemplate[] = [
  yunoPersona,
  plannerPrompt,
  multimodalPrompt,
  replyerPrompt,
  plannerCompressionPrompt,
  replyerCompressionPrompt,
];
