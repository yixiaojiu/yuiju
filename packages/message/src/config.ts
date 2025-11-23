import type { NCWebsocketOptions } from 'node-napcat-ts';

interface AppConfig {
  // Napcat 配置
  napcat: NCWebsocketOptions;
  // QQ 聊天白名单
  whiteList: number[];
  // MongoDB connection URI
  mongoUri: string;
  mem0: {
    apiKey: string;
    filterScore?: number;
  };
  tts: {
    endpoint: string;
    text_lang: string;
    ref_audio_path: string;
    prompt_lang: string;
    prompt_text: string;
    text_split_method: string;
    media_type: string;
    streaming_mode: boolean;
    volume?: number;
    temperature?: number;
  };
}

export const config: AppConfig = {
  napcat: {
    protocol: 'ws',
    host: '192.168.31.10',
    port: 3001,
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
  },
  whiteList: [1918418506],
  mongoUri: process.env.MONGO_URI || '',
  mem0: {
    apiKey: process.env.MEM0AI_API_KEY || '',
    filterScore: 0.7,
  },
  tts: {
    endpoint: 'http://127.0.0.1:9880/tts',
    text_lang: 'zh',
    ref_audio_path:
      '/Users/yixiaojiu/Resource/GPT-SoVITS-Modal/满穗/良爷，你先别不行。先听我说。良爷杀了兴爷，再把其他几个孩子都送走。.MP3',
    prompt_lang: 'zh',
    prompt_text: '良爷，你先别不行。先听我说。良爷杀了兴爷，再把其他几个孩子都送走。',
    text_split_method: 'cut5',
    media_type: 'wav',
    streaming_mode: false,
    volume: 1.0,
    temperature: 0.9,
  },
};
