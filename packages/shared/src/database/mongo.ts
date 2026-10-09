import { mongo } from "mongoose";
import { load_config } from "../config/load";

const clients: Partial<Record<"primary" | "sync", mongo.MongoClient>> = {};
const connections: Partial<Record<"primary" | "sync", Promise<mongo.MongoClient>>> = {};

/** 同一进程共用连接池；失败不缓存为成功，归档下一轮可重新连接。 */
export async function getMongoDatabase(source: "primary" | "sync" = "primary"): Promise<mongo.Db> {
  const config = await load_config();
  const field = source === "primary" ? "mongo_uri" : "sync_mongo_uri";
  const uri = config.database?.[field];
  if (!uri) {
    throw new Error(`缺少 database.${field}`);
  }
  clients[source] ??= new mongo.MongoClient(uri, {
    ...(source === "sync" ? { serverSelectionTimeoutMS: 10_000 } : {}),
  });
  connections[source] ??= clients[source].connect();
  try {
    return (await connections[source]).db();
  } catch (error) {
    delete connections[source];
    throw error;
  }
}

/** 由应用在所有数据库使用方停止后关闭。 */
export async function closeMongo(): Promise<void> {
  await Promise.all(Object.values(clients).map((client) => client.close()));
  for (const source of ["primary", "sync"] as const) {
    delete clients[source];
    delete connections[source];
  }
}
