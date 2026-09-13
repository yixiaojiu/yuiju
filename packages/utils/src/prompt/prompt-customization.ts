import type {
  PromptCustomizationKey,
  PromptCustomizationOverrideMap,
} from "../types/prompt-customization";
import { defaultCharacterPrompt } from "./character-card";
import { defaultDiaryPrompt } from "./diary";
import { defaultChatBehaviorPrompt, defaultChatPrompt, defaultChatReplyPrompt } from "./message";
import { defaultChooseActionPrompt, defaultWorldPrompt } from "./world-view";

export const defaultPromptCustomizations: Record<PromptCustomizationKey, string> = {
  character: defaultCharacterPrompt,
  world: defaultWorldPrompt,
  chat: defaultChatPrompt,
  chatBehavior: defaultChatBehaviorPrompt,
  chatReply: defaultChatReplyPrompt,
  chooseAction: defaultChooseActionPrompt,
  diary: defaultDiaryPrompt,
};

export function getPromptCustomizationContent(
  key: PromptCustomizationKey,
  overrides: PromptCustomizationOverrideMap,
): string {
  return overrides[key]?.content ?? defaultPromptCustomizations[key];
}
