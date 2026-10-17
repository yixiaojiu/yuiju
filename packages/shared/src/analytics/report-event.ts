import type { mongo } from "mongoose";
import { mongoCollectionName } from "../database/environment";
import { getMongoDatabase } from "../database/mongo";

type AnalyticsEvent = {
  eventName: string;
  eventData: Record<string, unknown>;
  eventTime: Date;
};

let collectionTask: Promise<mongo.Collection<AnalyticsEvent>> | undefined;

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
 * 不做可靠投递，进程退出可能丢失在途埋点；事件按发生时间保留 30 天。
 */
export async function reportAnalyticsEvent(
  input: Omit<AnalyticsEvent, "eventTime">,
): Promise<void> {
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
