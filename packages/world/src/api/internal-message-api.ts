import { getYuijuConfig } from "@yuiju/utils";

export interface InternalStickerContext {
  promptSection: string;
  stickers: {
    key: string;
    description: string;
  }[];
}

export interface InternalGroupConversationContext {
  groupId: number;
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

  async getGroupContext(groupId: number, limit: number) {
    const response = await fetch(
      `${this.baseUrl}/internal/groups/${groupId}/context?limit=${limit}`,
    );
    return (await response.json()) as InternalGroupConversationContext;
  }

  async sendGroupMessage(groupId: number, message: string) {
    const response = await fetch(`${this.baseUrl}/internal/groups/${groupId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message,
      }),
    });
    await response.json();
  }
}

export const internalMessageApi = new InternalMessageApi();
