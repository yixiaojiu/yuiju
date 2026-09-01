export const ExperimentId = {
  BatchedChatReply: "batched-chat-reply",
} as const;

export type ExperimentId = (typeof ExperimentId)[keyof typeof ExperimentId];

const experimentState: Record<ExperimentId, boolean> = {
  [ExperimentId.BatchedChatReply]: true,
};

export const experimentManager = {
  isEnabled(experimentId: ExperimentId): boolean {
    return experimentState[experimentId];
  },
};
