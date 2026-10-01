import type { Config } from "@yuiju/shared/config/schema";
import { Conversation } from "./conversation/conversation";

export type CharacterConfig = NonNullable<Config["characters"]>[string];

export class Character {
  readonly name: string;
  readonly nicknames: readonly string[];
  private readonly conversation: Conversation | undefined;

  constructor(
    readonly id: string,
    config: CharacterConfig,
  ) {
    this.name = config.name;
    this.nicknames = config.nicknames ?? [];
    if (config.onebot) this.conversation = new Conversation(this, config.onebot);
  }

  async start() {
    await this.conversation?.start();
  }

  async stop() {
    await this.conversation?.stop();
  }
}
