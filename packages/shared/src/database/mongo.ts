import { mongo } from "mongoose";
import { load_config } from "../config/load";

let client: mongo.MongoClient | undefined;
let connection: Promise<mongo.MongoClient> | undefined;

/** 同一进程共用连接池；失败不缓存为成功，归档下一轮可重新连接。 */
export async function getMongoDatabase(): Promise<mongo.Db> {
  const config = await load_config();
  if (!config.database?.mongo_uri) throw new Error("缺少 database.mongo_uri");
  client ??= new mongo.MongoClient(config.database.mongo_uri);
  connection ??= client.connect();
  try {
    return (await connection).db();
  } catch (error) {
    connection = undefined;
    throw error;
  }
}

/** 由应用在所有数据库使用方停止后关闭。 */
export async function closeMongo(): Promise<void> {
  await client?.close();
  client = undefined;
  connection = undefined;
}
