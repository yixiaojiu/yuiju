import mongoose, { Document, Schema } from 'mongoose';

// 定义接口
export interface IQQChatMessage extends Document {
  senderName: string;
  content: string;
  timestamp: Date;
}

// 定义Schema
const QQMessageSchema = new Schema<IQQChatMessage>({
  senderName: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

// 创建并导出模型
export default mongoose.model<IQQChatMessage>('QQMessage', QQMessageSchema);