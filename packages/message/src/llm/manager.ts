import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { Conversation } from '../conversation';
import MemoryClient from 'mem0ai';
import { config } from '@/config';
import { memorySearchTool } from '@/llm/tools/memorySearchTool';

export class LLMManager {
  private deepseekClient: ReturnType<typeof createDeepSeek>;
  private modelName: string;
  private conversation: Conversation;
  private systemPrompt: string = '';
  private mem0Client: MemoryClient;

  constructor(modelName: string = 'deepseek-chat', conversationLimit: number = 10) {
    this.deepseekClient = createDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    });
    this.modelName = modelName;
    this.conversation = new Conversation(conversationLimit);
    this.mem0Client = new MemoryClient({ apiKey: config.mem0.apiKey });
  }

  public setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  public addMessage(role: 'user' | 'assistant', content: string) {
    this.conversation.add(role, content);
  }

  public async chatWithLLM(input: string, userName: string) {
    // 添加用户输入到对话历史
    this.conversation.add('user', input);

    // 获取对话历史
    const messages: ModelMessage[] = this.conversation.getMessages(input);

    const model = this.deepseekClient(this.modelName);

    const result = await generateText({
      model,
      messages,
      system: this.systemPrompt,
      // stopWhen: stepCountIs(5),
      // tools: {
      //   memorySearchTool,
      // },
    });

    // 添加助手回复到对话历史
    this.conversation.add('assistant', result.text);

    // this.mem0Client.add(
    //   [
    //     {
    //       role: 'user',
    //       content: input,
    //     },
    //     {
    //       role: 'assistant',
    //       content: result.text,
    //     },
    //   ],
    //   { user_id: userName }
    // );

    return result;
  }

  public getClient() {
    return this.deepseekClient(this.modelName);
  }
}

// 导出默认实例
export const llmManager = new LLMManager();
