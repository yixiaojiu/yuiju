import mongoose, { type Connection } from "mongoose";
import { getYuijuConfig } from "../config";

export type MongoReadSource = "primary" | "sync";

let mongoConnection: Promise<Connection> | null = null;
let syncMongoConnection: Promise<Connection | null> | null = null;

export const hasSyncMongoUri = (): boolean => {
  return Boolean(getYuijuConfig().database.syncMongoUri?.trim());
};

export const connectDB = async () => {
  if (mongoConnection) {
    return mongoConnection;
  }

  const uri = getYuijuConfig().database.mongoUri.trim();
  if (!uri) {
    throw new Error("yuiju.config.ts 中的 database.mongoUri 未配置");
  }

  const connectionPromise = mongoose.connect(uri).then(() => mongoose.connection);
  mongoConnection = connectionPromise;
  return connectionPromise;
};

export const connectSyncDB = async (): Promise<Connection | null> => {
  if (syncMongoConnection) {
    return syncMongoConnection;
  }

  if (!hasSyncMongoUri()) {
    return null;
  }

  const uri = getYuijuConfig().database.syncMongoUri?.trim() as string;
  const connectionPromise = mongoose.createConnection(uri).asPromise();
  syncMongoConnection = connectionPromise;
  return connectionPromise;
};

export const getMongoConnection = async (source: MongoReadSource = "primary") => {
  if (source === "primary") {
    await connectDB();
    return mongoose.connection;
  }

  const syncConnection = await connectSyncDB();
  if (!syncConnection) {
    throw new Error("database.syncMongoUri is not configured, cannot read from sync MongoDB");
  }
  return syncConnection;
};
