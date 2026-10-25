import type { mongo } from "mongoose";
import { mongoCollectionName } from "../database/environment";
import { getMongoDatabase } from "../database/mongo";

type AnalyticsEvent = {
  eventName: string;
  eventData: Record<string, unknown>;
  eventTime: Date;
};

let collectionTask: Promise<mongo.Collection<AnalyticsEvent>> | undefined;
/** 只跟踪当前进程中的写入，用于正常退出时等待，不保存或重试失败事件。 */
const pendingReports = new Set<Promise<void>>();

async function initializeCollection(): Promise<mongo.Collection<AnalyticsEvent>> {
  const collection = (await getMongoDatabase()).collection<AnalyticsEvent>(
    mongoCollectionName("analytics_events"),
  );
  await collection.createIndexes([
    { key: { eventName: 1, eventTime: -1 } },
    { key: { eventTime: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60 },
  ]);
  return collection;
}

/**
 * 调用处直接异步上报，不等待写入；写入失败只输出到控制台，不改变业务结果。
 * 不做可靠投递；正常退出可等待在途写入，强制退出仍可能丢失。事件保留 30 天。
 */
export async function reportAnalyticsEvent(
  input: Omit<AnalyticsEvent, "eventTime">,
): Promise<void> {
  const writing = writeAnalyticsEvent(input);
  pendingReports.add(writing);
  try {
    await writing;
  } finally {
    pendingReports.delete(writing);
  }
}

/** 业务停止产生事件后调用，等待在途写入完成，再关闭 MongoDB。 */
export async function flushAnalyticsEvents(): Promise<void> {
  await Promise.all(pendingReports);
}

async function writeAnalyticsEvent(input: Omit<AnalyticsEvent, "eventTime">): Promise<void> {
  const event: AnalyticsEvent = { ...input, eventTime: new Date() };
  try {
    collectionTask ??= initializeCollection();
    let collection: mongo.Collection<AnalyticsEvent>;
    try {
      collection = await collectionTask;
    } catch (error) {
      collectionTask = undefined;
      throw error;
    }
    await collection.insertOne(event);
  } catch (error) {
    // 不使用公共 logger，否则写入失败会再次产生 app.error，形成递归上报。
    console.error("埋点写入失败", { eventName: input.eventName, error });
  }
}
