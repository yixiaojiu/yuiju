import mongoose from 'mongoose';
import QQMessage from './schema/qqMessage.schema';
import { type IQQChatMessage } from './schema/qqMessage.schema';
import { config } from './config';

// 连接MongoDB数据库
export const connectDB = async () => {
  await mongoose.connect(config.mongoUri);
};

// 封装数据库写入操作 - 保存消息
export const saveQQMessage = async (messageData: Partial<IQQChatMessage>) => {
  const message = new QQMessage(messageData);
  return await message.save();
};
