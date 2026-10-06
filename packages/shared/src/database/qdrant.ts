import { QdrantClient } from "@qdrant/js-client-rest";
import { load_config } from "../config/load";

let client: QdrantClient | undefined;

/** 共用项目配置中的向量数据库连接；记忆的 collection 和索引由业务模块维护。 */
export async function getQdrant(): Promise<QdrantClient> {
  const config = (await load_config()).database?.qdrant;
  if (!config) {
    throw new Error("缺少 database.qdrant 配置");
  }
  client ??= new QdrantClient({ url: config.base_url });
  return client;
}
