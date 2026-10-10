import { mainAgentPrompt, mainCompressionPrompt, mainRecoveryPrompt } from "./agent-loop/main";
import { yuunoInitialCognition } from "./character/yuuno/cognition";
import { yuunoMainPrompt } from "./character/yuuno/main";
import { yuunoPersona } from "./character/yuuno/persona";
import { yuunoPlannerPrompt } from "./character/yuuno/planner";
import { yuunoReplyerPrompt } from "./character/yuuno/replyer";
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
  cognitionReviewPrompt,
  conversationMemoryPrompt,
  experiencePrompt,
  memoryChunksPrompt,
  peoplePrompt,
  peopleReviewPrompt,
} from "./memory/organize";
import type { PromptTemplate } from "./template";
import { worldRandomEventPrompt } from "./world/random-event";

export const promptDefinitions: readonly PromptTemplate[] = [
  yuunoPersona,
  yuunoMainPrompt,
  yuunoPlannerPrompt,
  yuunoReplyerPrompt,
  experiencePrompt,
  memoryChunksPrompt,
  cognitionReviewPrompt,
  coarseMemoryPrompt,
  cognitionPrompt,
  conversationMemoryPrompt,
  peoplePrompt,
  peopleReviewPrompt,
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
