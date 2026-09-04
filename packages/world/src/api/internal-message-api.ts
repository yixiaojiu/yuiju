import { getYuijuConfig } from "@yuiju/utils/config/config";

export type InternalMessagePlatform = "onebot" | "lark";

export interface InternalStickerContext {
  promptSection: string;
  stickers: {
    key: string;
    description: string;
  }[];
}

export interface InternalGroupConversationContext {
  platform: InternalMessagePlatform;
  groupId: string;
  groupLabel: string;
  summary?: string;
  historyJson: string;
}

export class InternalMessageApi {
  private readonly baseUrl: string;

  constructor() {
    const config = getYuijuConfig();
    this.baseUrl = `http://${config.message.internalApi.host}:${config.message.internalApi.port}`;
  }

  async getStickers() {
    const response = await fetch(`${this.baseUrl}/internal/stickers`);
    return (await response.json()) as InternalStickerContext;
  }

  async getGroupContext(platform: InternalMessagePlatform, groupId: string, limit: number) {
    const response = await fetch(
      `${this.baseUrl}/internal/${platform}/groups/${groupId}/context?limit=${limit}`,
    );
    return (await response.json()) as InternalGroupConversationContext;
  }

  async sendGroupMessage(platform: InternalMessagePlatform, groupId: string, message: string) {
    const response = await fetch(
      `${this.baseUrl}/internal/${platform}/groups/${groupId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      },
    );
    await response.json();
  }

  async flushUserWindows() {
    const response = await fetch(`${this.baseUrl}/internal/chat/windows/flush`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`聊天窗口归档失败：${response.status} ${response.statusText}`);
    }
  }

  async updateDailyPersonMemories(diaryDate: Date) {
    const response = await fetch(`${this.baseUrl}/internal/chat/person-memories/update`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ diaryDate: diaryDate.toISOString() }),
    });
    if (!response.ok) {
      throw new Error(`每日人物记忆更新失败：${response.status} ${response.statusText}`);
    }
  }
}

export const internalMessageApi = new InternalMessageApi();
