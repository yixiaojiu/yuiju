import type { ContextSummary, ContextUnit } from "./context";
import type { ConversationWait } from "./loop";
import type { ConversationMessage, ConversationScope } from "./message";

/** 会话持久化快照；不包含 Promise、定时器等仅属于当前进程的运行资源。 */
export type ConversationState = {
  /** 已消费的外部输入序号，发送失败后也不回退以免重复执行。 */
  processedThrough: number;
  /** Planner 的未压缩完整交互及摘要；交互序号与群消息序号独立。 */
  planner: { history: ContextUnit[]; summary: Readonly<ContextSummary> };
  /** Replyer 摘要及其覆盖的群消息序号。 */
  replyerSummary: Readonly<ContextSummary>;
  /** Planner 主动等待的起止时间；不是沉默退避。 */
  waiting?: ConversationWait;
  /** 失败时已知的输入边界，必须收到更晚的消息才重新规划。 */
  failedThroughSequence?: number;
  /** 连续主动沉默次数；等待或已确认发送会将其清零。 */
  silentRounds: number;
  /** 普通消息的沉默退避截止时间，单位 Unix 毫秒，0 表示无退避。 */
  silenceCooldownUntil: number;
};

/** 保存收到的事件或平台已确认发送的事件；MongoDB 写入尚未实现。 */
export async function saveConversationMessage(
  scope: ConversationScope,
  message: ConversationMessage,
): Promise<void> {
  // TODO MongoDB：保存接收事件或实际发送成功的消息，按会话与 sequence 排序。
  throw new Error("saveConversationMessage 尚未实现 MongoDB 写入");
}

/** 按会话序号范围或平台消息 ID 查询；MongoDB 查询尚未实现。 */
export async function queryConversationMessages(
  scope: ConversationScope,
  range: { after: number; through?: number } | { messageId: string },
): Promise<ConversationMessage[]> {
  // TODO MongoDB：按 (after, through] 查询并按 sequence 升序，或按平台消息 ID 精确查询。
  // 旧消息原文移出内存后，引用内容通过 ID 查询，不重新加入模型历史。
  throw new Error("queryConversationMessages 尚未实现 MongoDB 查询");
}

/** 读取会话快照；Redis 查询及重启恢复尚未实现。 */
export async function loadConversationState(
  scope: ConversationScope,
): Promise<ConversationState | null> {
  // TODO Redis：读取会话状态；只有确实不存在时才返回 null。本阶段不接入重启恢复。
  throw new Error("loadConversationState 尚未实现 Redis 查询");
}

/** 保存轮次结束后的状态快照；Redis 写入尚未实现，失败不能回退已发送的行为。 */
export async function saveConversationState(
  scope: ConversationScope,
  state: ConversationState,
): Promise<void> {
  // TODO Redis：保存规划历史、处理位置、摘要、等待与触发状态。
  throw new Error("saveConversationState 尚未实现 Redis 写入");
}
