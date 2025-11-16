import 'dotenv/config';
import { NCWebsocket, Structs, type AllHandlers } from 'node-napcat-ts';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';
import { getPromptMessage } from './prompt';
import { Conversation } from './conversation';

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
});

const whiteList = [1918418506];

const conversation = new Conversation();

const napcat = new NCWebsocket(
  {
    protocol: 'ws',
    host: '192.168.31.10',
    port: 3001,
    accessToken: process.env.NAPCAT_TOKEN || '',
    // 是否需要在触发 socket.error 时抛出错误, 默认关闭
    throwPromise: true,
    // ↓ 自动重连(可选)
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
    // ↓ 是否开启 DEBUG 模式
  },
  false
);

// 背后调用的接口是 .handle_quick_operation
// 只支持 message request 这两个事件
napcat.on('message.private', messageHandler);

async function messageHandler(context: AllHandlers['message.private']) {
  let receiveMessage;
  for (const item of context.message) {
    if (item.type === 'text') {
      receiveMessage = item.data.text;
    }
  }

  if (!receiveMessage) {
    return;
  }

  if (!whiteList.includes(context.sender.user_id) && !context.sender.nickname) {
    return;
  }

  console.log(`收到来自 ${context.sender.nickname}(${context.sender.user_id}) 的消息: ${receiveMessage}`);

  const userName = context.sender.nickname;

  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      await context.quick_action([Structs.text('DeepSeek 未配置，稍后再试呢~')]);
      return;
    }

    const systemPrompt = getPromptMessage(userName);
    const messages = conversation.getMessages(context.sender.user_id, receiveMessage);

    const { text } = await generateText({
      model: deepseek('deepseek-chat'),
      system: systemPrompt,
      messages,
    });

    const reply = (text || '').trim() || '呜…这句话我一时没理解呢。';
    conversation.add(context.sender.user_id, 'human', receiveMessage);
    conversation.add(context.sender.user_id, 'assistant', reply);
    console.log(`回复给 ${context.sender.nickname}(${context.sender.user_id}) 的消息: ${reply}`);
    await context.quick_action([Structs.text(reply)]);
  } catch (error) {
    await context.quick_action([Structs.text('小久刚刚摔了一跤，重试下呀~')]);
  }
}

napcat.connect();
