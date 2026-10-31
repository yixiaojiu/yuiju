import { type h, MessageEncoder, Universal } from "@satorijs/core";
import type { BaseBot } from "./base";
import type { CQCode } from "./cqcode";

export class OneBotMessageEncoder extends MessageEncoder {
  private children: CQCode[] = [];

  async flush() {
    while (this.children[0]?.type === "text") {
      this.children[0].data.text = this.children[0].data.text.trimStart();
      if (this.children[0].data.text) break;
      this.children.shift();
    }

    while (this.children.at(-1)?.type === "text") {
      const last = this.children.at(-1)!;
      last.data.text = last.data.text.trimEnd();
      if (last.data.text) break;
      this.children.pop();
    }

    if (!this.children.length) return;

    const guildId =
      this.referrer ?? (this.channelId.startsWith("private:") ? undefined : this.channelId);
    const bot = this.bot as BaseBot;
    const messageId = guildId
      ? await bot.internal.sendGroupMsg(guildId, this.children)
      : await bot.internal.sendPrivateMsg(this.channelId.slice("private:".length), this.children);

    this.results.push({
      id: String(messageId),
      messageId: String(messageId),
      channel: {
        id: this.channelId,
        type: guildId ? Universal.Channel.Type.TEXT : Universal.Channel.Type.DIRECT,
      },
      guild: guildId ? { id: guildId } : undefined,
      content: this.session.content,
      elements: this.session.elements,
      timestamp: Date.now(),
    });
    this.children = [];
  }

  private text(content: string) {
    this.children.push({ type: "text", data: { text: content } });
  }

  async visit(element: h) {
    const { type, attrs, children } = element;

    if (type === "text") {
      this.text(attrs.content);
    } else if (type === "br") {
      this.text("\n");
    } else if (type === "p") {
      await this.render(children);
      this.text("\n");
    } else if (type === "at") {
      this.children.push({
        type: "at",
        data: { qq: attrs.type === "all" ? "all" : attrs.id, name: attrs.name },
      });
    } else if (type === "quote") {
      await this.flush();
      if (attrs.id) this.children.push({ type: "reply", data: { id: attrs.id } });
    } else if (type === "face") {
      this.children.push({ type: "face", data: { id: attrs.id } });
    } else if (type === "mface") {
      this.children.push({
        type: "mface",
        data: {
          emoji_id: attrs.emojiId,
          emoji_package_id: attrs.emojiPackageId,
          key: attrs.key,
          summary: attrs.summary,
        },
      });
    } else if (type === "image" || type === "img") {
      this.children.push({
        type: "image",
        data: {
          file: attrs.url || attrs.src,
          cache: attrs.cache ? 1 : 0,
          summary: attrs.summary,
          sub_type: attrs.subType,
        },
      });
    } else if (type === "audio") {
      this.children.push({
        type: "record",
        data: {
          file: attrs.url || attrs.src,
          cache: attrs.cache ? 1 : 0,
        },
      });
    } else if (type === "video") {
      this.children.push({
        type: "video",
        data: {
          file: attrs.url || attrs.src,
          cache: attrs.cache ? 1 : 0,
        },
      });
    } else if (type === "a") {
      await this.render(children);
      if (attrs.href) this.text(` (${attrs.href})`);
    } else if (type === "sharp") {
      if (attrs.id) this.text(attrs.id);
    } else {
      await this.render(children);
    }
  }
}
