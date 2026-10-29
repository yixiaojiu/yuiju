import { mainAgentPrompt, mainCompressionPrompt, mainRecoveryPrompt } from "./agent-loop/main";
import { multimodalPrompt } from "./conversation/multimodal";
import { pausedConversationPrompt } from "./conversation/paused";
import { plannerPrompt } from "./conversation/planner";
import { plannerCompressionPrompt } from "./conversation/planner-compression";
import { replyerPrompt } from "./conversation/replyer";
import { replyerCompressionPrompt } from "./conversation/replyer-compression";
import {
  replyerGenericEmpathyPrompt,
  replyerOverexplainingPrompt,
  replyerUnwantedAdvicePrompt,
} from "./conversation/replyer-quality";
import { emotionReviewPrompt } from "./emotion/review";
import { emotionUpdatePrompt } from "./emotion/update";
import {
  coarseMemoryPrompt,
  cognitionPrompt,
  cognitionReviewPrompt,
  conversationMemoryPrompt,
  experiencePrompt,
  initialCognitionPrompt,
  memoryChunksPrompt,
  peoplePrompt,
  peopleReviewPrompt,
} from "./memory/organize";
import type { PromptTemplate } from "./template";
import { worldRandomEventPrompt } from "./world/random-event";

export const promptDefinitions: readonly PromptTemplate[] = [
  initialCognitionPrompt,
  experiencePrompt,
  memoryChunksPrompt,
  cognitionReviewPrompt,
  coarseMemoryPrompt,
  cognitionPrompt,
  conversationMemoryPrompt,
  peoplePrompt,
  peopleReviewPrompt,
  emotionUpdatePrompt,
  emotionReviewPrompt,
  mainAgentPrompt,
  mainCompressionPrompt,
  mainRecoveryPrompt,
  pausedConversationPrompt,
  plannerPrompt,
  multimodalPrompt,
  replyerPrompt,
  plannerCompressionPrompt,
  replyerCompressionPrompt,
  replyerUnwantedAdvicePrompt,
  replyerGenericEmpathyPrompt,
  replyerOverexplainingPrompt,
  worldRandomEventPrompt,
];
