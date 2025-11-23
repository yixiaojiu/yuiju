import fs from 'node:fs';
import path from 'node:path';

interface Conversation {
  human: string;
  assistant: string;
}

interface TrainData {
  system: string;
  conversation: Conversation[];
}

function jsonToJsonl() {
  const jsonPath = path.join(__dirname, '../dataset/llm-generation3.json');
  const outputPath = path.join(__dirname, '../dataset/temp.jsonl');

  const fileContent = fs.readFileSync(jsonPath, 'utf-8');

  const jsonObjects: TrainData[] = JSON.parse(fileContent);
  const jsonlContent = jsonObjects.map(obj => JSON.stringify(obj)).join('\n');
  fs.writeFileSync(outputPath, jsonlContent, 'utf-8');
}

function jsonlToJson() {
  // 读取 JSONL 文件
  const jsonlPath = path.join(__dirname, '../dataset/handwritten.jsonl');
  const outputPath = path.join(__dirname, '../dataset/handwritten.json');

  try {
    // 读取文件内容
    const fileContent = fs.readFileSync(jsonlPath, 'utf-8');

    // 将每行解析为 JSON 对象
    const jsonObjects: TrainData[] = fileContent
      .split('\n')
      .filter(line => line.trim() !== '') // 过滤空行
      .map(line => JSON.parse(line));

    // 写入 JSON 文件
    fs.writeFileSync(outputPath, JSON.stringify(jsonObjects, null, 2), 'utf-8');

    console.log('转换完成！文件已保存到:', outputPath);
  } catch (error) {
    console.error('转换过程中发生错误:', error);
  }
}

function convertTrainDataToShareGPT() {
  const jsonPath = path.join(__dirname, '../dataset/train.json');
  const outPath = path.join(__dirname, '../dataset/sharegpt_train.json');

  const fileContent = fs.readFileSync(jsonPath, 'utf-8');
  const trainData: TrainData[] = JSON.parse(fileContent);

  const converted = trainData.map(item => {
    const conversations: any[] = [];
    for (const pair of item.conversation) {
      conversations.push({ from: 'human', value: pair.human });
      conversations.push({ from: 'gpt', value: pair.assistant });
    }

    return {
      system: item.system,
      conversations,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(converted, null, 2), 'utf-8');
}

function modifySystemPrompt(systemPrompt: string) {
  const jsonlPath = path.join(__dirname, '../dataset/llm-generation.jsonl');

  try {
    // 读取文件内容
    const fileContent = fs.readFileSync(jsonlPath, 'utf-8');

    // 将每行解析为 JSON 对象
    const jsonObjects: TrainData[] = fileContent
      .split('\n')
      .filter(line => line.trim() !== '') // 过滤空行
      .map<TrainData>(line => JSON.parse(line));

    jsonObjects.map(item => {
      item.system = systemPrompt;
    });

    // 写入 JSON 文件
    fs.writeFileSync(jsonlPath, jsonObjects.map(item => JSON.stringify(item)).join('\n'), 'utf-8');

    console.log('转换完成！文件已保存到:', jsonlPath);
  } catch (error) {
    console.error('转换过程中发生错误:', error);
  }
}

modifySystemPrompt('你是一个名为ゆいじゅ的女孩子，你的昵称叫悠酱。');
