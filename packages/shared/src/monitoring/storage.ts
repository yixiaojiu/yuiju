import type { mongo } from "mongoose";
import { mongoCollectionName } from "../database/environment";
import { getMongoDatabase } from "../database/mongo";

/** 一次实际发出的告警，不表示当前健康状态或人工处理进度。 */
export type MonitoringAlert = {
  monitor_key: string;
  app: string;
  character_id?: string;
  channel_id?: string;
  severity: "warning" | "error";
  title: string;
  impact: string;
  message: string;
  consecutive_failures: number;
  created_at: Date;
};

export type MonitoringAlertEntry = Omit<MonitoringAlert, "created_at"> & {
  id: string;
  created_at: number;
};

export type MonitoringAlertsResult = {
  entries: MonitoringAlertEntry[];
  total: number;
  page: number;
  pageSize: number;
};

let collectionTask: Promise<mongo.Collection<MonitoringAlert>> | undefined;
/** 仅跟踪在途写入，供正常退出等待；失败告警不进入重试队列。 */
const pendingWrites = new Set<Promise<void>>();

async function initializeCollection(): Promise<mongo.Collection<MonitoringAlert>> {
  const collection = (await getMongoDatabase()).collection<MonitoringAlert>(
    mongoCollectionName("monitoring_alerts"),
  );
  await collection.createIndexes([
    { key: { created_at: 1 }, expireAfterSeconds: 14 * 24 * 60 * 60 },
    { key: { character_id: 1, created_at: -1 } },
  ]);
  return collection;
}

/** 后台保存告警；调用方不等待。写入失败只输出摘要，不影响业务，也不递归告警。 */
export async function writeMonitoringAlert(alert: MonitoringAlert): Promise<void> {
  const writing = insertAlert(alert);
  pendingWrites.add(writing);
  try {
    await writing;
  } finally {
    pendingWrites.delete(writing);
  }
}

async function insertAlert(alert: MonitoringAlert): Promise<void> {
  try {
    collectionTask ??= initializeCollection();
    let collection: mongo.Collection<MonitoringAlert>;
    try {
      collection = await collectionTask;
    } catch (error) {
      // 初始化失败的任务不缓存，下一条新告警可正常建立连接；不重放本条记录。
      collectionTask = undefined;
      throw error;
    }
    await collection.insertOne({
      ...alert,
      message: Array.from(alert.message).slice(0, 1000).join(""),
    });
  } catch (error) {
    // 公共 logger 会产生 app.error 埋点；监控存储失败不再触发其他上报。
    console.error("告警写入失败", {
      monitorKey: alert.monitor_key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 先停止所有告警产生方，再等待此函数完成，最后关闭 MongoDB。 */
export async function flushMonitoringAlerts(): Promise<void> {
  await Promise.all(pendingWrites);
}

/** 只查询告警历史；日期边界由 API 按项目时区转换，结束时间不包含在内。 */
export async function queryMonitoringAlerts(query: {
  start: Date;
  end: Date;
  characterId?: string;
  monitorKey?: string;
  severity?: MonitoringAlert["severity"];
  page: number;
}): Promise<MonitoringAlertsResult> {
  const collection = (await getMongoDatabase()).collection<MonitoringAlert>(
    mongoCollectionName("monitoring_alerts"),
  );
  const filter = {
    created_at: { $gte: query.start, $lt: query.end },
    ...(query.characterId && { character_id: query.characterId }),
    ...(query.monitorKey && { monitor_key: query.monitorKey }),
    ...(query.severity && { severity: query.severity }),
  };
  const pageSize = 20;
  const [records, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ created_at: -1, _id: -1 })
      .skip((query.page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(filter),
  ]);
  return {
    entries: records.map(({ _id, created_at, ...alert }) => ({
      ...alert,
      id: _id.toHexString(),
      created_at: created_at.getTime(),
    })),
    total,
    page: query.page,
    pageSize,
  };
}
