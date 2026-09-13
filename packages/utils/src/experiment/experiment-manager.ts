export const ExperimentId = {
  BatchedChatReply: "batched-chat-reply",
  PlannerReplyerChat: "planner-replyer-chat",
} as const;

export type ExperimentId = (typeof ExperimentId)[keyof typeof ExperimentId];

const experimentState: Record<ExperimentId, boolean> = {
  [ExperimentId.BatchedChatReply]: true,
  [ExperimentId.PlannerReplyerChat]: true,
};

export const experimentManager = {
  isEnabled(experimentId: ExperimentId): boolean {
    return experimentState[experimentId];
  },
};
