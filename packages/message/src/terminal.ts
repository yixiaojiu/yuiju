import 'dotenv/config';
import * as readline from 'readline';
import { llmManager } from './llm/manager';
import { synthesizeAndPlay } from './tts';
import { getCharacterCardPrompt } from '@yuiju/source';

// 设置终端输入输出接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.prompt();

// 监听终端输入事件
rl.on('line', async input => {
  if (!input.trim()) {
    rl.prompt();
    return;
  }

  try {
    const systemPrompt = getCharacterCardPrompt({
      userName: '翊小久',
    });
    llmManager.setSystemPrompt(systemPrompt);

    // 调用DeepSeek API生成回复
    const { text } = await llmManager.chatWithLLM(input.trim(), '翊小久');

    const reply = (text || '').trim() || 'Error：未获取到回复';

    // 输出回复到终端
    console.log(`悠酱: ${reply}`);
    await synthesizeAndPlay(reply);
  } catch (error) {
    console.error('发生错误:', error instanceof Error ? error.message : String(error));
  } finally {
    rl.prompt();
  }
});

// 监听退出事件
rl.on('close', () => {
  console.log('对话已结束，再见！');
  process.exit(0);
});
