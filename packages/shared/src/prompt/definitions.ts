import { mainAgentPrompt, mainCompressionPrompt, mainRecoveryPrompt } from "./agent-loop/main";
import { yuunoPersona } from "./character/yuuno";
import { yuunoInitialCognition } from "./character/yuuno-cognition";
import { multimodalPrompt } from "./conversation/multimodal";
import { pausedConversationPrompt } from "./conversation/paused";
import { plannerPrompt } from "./conversation/planner";
import { plannerCompressionPrompt } from "./conversation/planner-compression";
import { replyerPrompt } from "./conversation/replyer";
import { replyerCompressionPrompt } from "./conversation/replyer-compression";
import { emotionUpdatePrompt } from "./emotion/update";
import {
  coarseMemoryPrompt,
  cognitionPrompt,
  experiencePrompt,
  peoplePrompt,
} from "./memory/organize";
import type { PromptTemplate } from "./template";
import { worldRandomEventPrompt } from "./world/random-event";

export const promptDefinitions: readonly PromptTemplate[] = [
  yuunoPersona,
  experiencePrompt,
  coarseMemoryPrompt,
  cognitionPrompt,
  peoplePrompt,
  yuunoInitialCognition,
  emotionUpdatePrompt,
  mainAgentPrompt,
  mainCompressionPrompt,
  mainRecoveryPrompt,
  pausedConversationPrompt,
  plannerPrompt,
  multimodalPrompt,
  replyerPrompt,
  plannerCompressionPrompt,
  replyerCompressionPrompt,
  worldRandomEventPrompt,
];
