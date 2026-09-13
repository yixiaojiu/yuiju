export const promptCustomizationKeys = [
  "character",
  "world",
  "chat",
  "chatBehavior",
  "chatReply",
  "chooseAction",
  "diary",
] as const;

export type PromptCustomizationKey = (typeof promptCustomizationKeys)[number];

export interface PromptCustomizationOverride {
  content: string;
  updatedAt: Date;
}

export type PromptCustomizationOverrideMap = Partial<
  Record<PromptCustomizationKey, PromptCustomizationOverride>
>;
