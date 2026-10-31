import { createHash } from "node:crypto";
import { Context, HTTP, h, type Session, Universal } from "@satorijs/core";
import { OneBotBot } from "@yuiju/satorijs-adapter-onebot/bot";
import { CQCode } from "@yuiju/satorijs-adapter-onebot/bot/cqcode";
import type { CustomFace } from "@yuiju/satorijs-adapter-onebot/types";
import type { Config } from "@yuiju/shared/config/schema";
import { logger } from "@yuiju/shared/logger/logger";
import { z } from "zod";
import type { IncomingEvent, IncomingMessage, IncomingPoke, ReplyTarget } from "./message";
import type { Sticker, StickerImage } from "./sticker";

/** demo 使用的原始 Session 接入；正式群聊由 OneBotConnection 过滤后接入。 */
export async function connectOneBot(
  config: OneBotBot.Config,
  onMessage: (session: Session) => void | Promise<void>,
  onNotice?: (session: Session) => void | Promise<void>,
) {
  const context = new Context({});
  context.plugin(HTTP);
  new OneBotBot(context, config);
  context.on("message-created", onMessage);
  if (onNotice) {
    context.on("internal/session", async (session) => {
      if (session.type === "notice") {
        await onNotice(session);
      }
    });
  }
  await context.start();
  return context;
}

export function readOneBotMessage(session: Session): IncomingMessage {
  // 这里只接收已通过白名单检查的 QQ 群消息，字段遵循 OneBot adapter 的群消息契约。
  return {
    kind: "message",
    id: z.string().parse(session.messageId),
    senderId: z.string().parse(session.userId),
    senderName: z.string().parse(session.author.name),
    timestamp: session.timestamp,
    isSelf: false,
    content: z.string().parse(session.content),
    ...(session.quote && {
      quote: {
        id: session.quote.id!,
        content: session.quote.content,
        senderId: session.quote.user?.id,
        senderName: session.quote.user?.name,
      },
    }),
  };
}

export function readOneBotPoke(session: Session): IncomingPoke {
  // adapter 将 OneBot target_id 暴露为 targetId，Satori 的通用声明没有这个字段。
  const targetSenderId = (session as Session & { targetId: string }).targetId;
  return {
    kind: "poke",
    senderId: z.string().parse(session.userId),
    senderName: z.string().parse(session.author.name),
    timestamp: session.timestamp,
    isSelf: false,
    targetSenderId,
  };
}

export type OneBotConfig = NonNullable<NonNullable<Config["characters"]>[string]["onebot"]>;

/** 一个角色的 OneBot 连接：限定接收范围，转换平台事件，并返回实际发送结果。 */
export class OneBotConnection {
  private context: Context | undefined;
  private bot!: OneBotBot;
  private accepting = false;

  constructor(
    private readonly characterName: string,
    private readonly config: OneBotConfig,
  ) {}

  async start(onMessage: (channelId: string, message: IncomingEvent) => Promise<void>) {
    const context = new Context({});
    this.context = context;
    context.plugin(HTTP);
    context.plugin(OneBotBot, {
      protocol: "ws",
      selfId: this.config.self_id,
      endpoint: this.config.endpoint,
      token: this.config.token,
      retryTimes: 6,
      retryInterval: 5_000,
      retryLazy: 60_000,
      responseTimeout: 120_000,
    });
    this.bot = context.bots[`onebot:${this.config.self_id}`] as OneBotBot;

    const receive = async (session: Session) => {
      // 平台入口先限定接收范围，白名单外的事件不能创建会话或写入历史。
      if (
        // 群文件上传是 adapter 合成的 message，没有普通消息 ID 和昵称。
        session.event.subtype === "guild-file-added" ||
        !this.accepting ||
        !session.guildId ||
        !this.config.group_white_list?.some((group) => group.group_id === session.guildId) ||
        session.userId === this.config.self_id
      ) {
        return;
      }

      try {
        let message: IncomingEvent;
        if (session.type === "message-created") {
          message = readOneBotMessage(session);
        } else if (session.type === "message-deleted") {
          // 撤回通知只有用户 ID；在平台入口补齐昵称，不依赖原消息仍在会话历史中。
          const member = await this.bot.getGuildMember(session.guildId, session.userId!);
          message = {
            kind: "recall",
            recalledMessageId: session.messageId!,
            operatorId: session.operatorId!,
            senderId: z.string().parse(session.userId),
            senderName: member.user!.name!,
            timestamp: session.timestamp,
            isSelf: false,
          };
        } else {
          message = readOneBotPoke(session);
        }
        if (message.kind === "poke" && message.targetSenderId !== this.config.self_id) {
          return;
        }
        logger.info("QQ 群事件已接收", {
          sender: message.senderName,
          kind: message.kind,
          content:
            message.kind === "message"
              ? message.content
              : message.kind === "poke"
                ? "戳了戳角色"
                : "消息被撤回",
        });
        await onMessage(session.channelId!, message);
      } catch (error) {
        logger.error("角色群聊接入失败", { error });
      }
    };

    // Satori 将 message 别名规范化为 message-created；notice 入口只放行戳一戳。
    context.on("message-created", receive);
    context.on("message-deleted", receive);
    context.on("internal/session", async (session) => {
      if (session.type === "notice" && session.subtype === "poke") {
        await receive(session);
      }
    });
    const online = new Promise<void>((resolve, reject) => {
      const dispose = context.on("bot-status-updated", (bot) => {
        if (bot.sid !== this.bot.sid) {
          return;
        }
        if (bot.status === Universal.Status.ONLINE) {
          dispose();
          resolve();
        } else if (bot.status === Universal.Status.OFFLINE) {
          dispose();
          reject(new Error("OneBot 登录失败", { cause: bot.error }));
        }
      });
    });
    this.accepting = true;
    await context.start();
    await online;
  }

  stopReceiving() {
    // 先关闭入口但保留连接，让已经决定的发送流程完成后再 stop。
    this.accepting = false;
  }

  async stop() {
    if (this.context) {
      // 先关闭连接并卸载 Bot，再释放其依赖的 HTTP 与 Satori 服务。
      await this.bot.stop();
      this.context.registry.delete(OneBotBot);
      await this.context.stop();
    }
  }

  async fetchFavoriteStickers(count: number): Promise<CustomFace[]> {
    return await this.bot.internal.fetchCustomFaceDetail(count);
  }

  async resolveStickerImage(
    channelId: string,
    messageId: string,
    imageIndex: number,
  ): Promise<StickerImage> {
    const message = await this.bot.internal.getMsg(messageId);
    if (String(message.group_id) !== channelId) {
      throw new Error("表情来源不属于当前群");
    }
    const images = CQCode.parse(message.message).filter((element) => element.type === "image");
    const image = z
      .object({
        file: z.string().min(1),
        url: z.string().url(),
        emojiId: z.string().optional(),
        emojiPackageId: z.union([z.number(), z.string()]).optional(),
        key: z.string().optional(),
      })
      .parse(images[imageIndex]?.attrs);
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`读取表情图片失败：HTTP ${response.status}`);
    }
    // 图片只在内存中读取以匹配已有收藏；实际收藏文件由 NapCat 获取。
    const md5 = createHash("md5")
      .update(new Uint8Array(await response.arrayBuffer()))
      .digest("hex");
    if (image.emojiId !== undefined) {
      const market = {
        emojiId: image.emojiId,
        packageId: Number(z.union([z.number(), z.string()]).parse(image.emojiPackageId)),
        key: z.string().min(1).parse(image.key),
      };
      const file = await this.bot.internal.downloadFile(image.url, [], 1);
      return { url: image.url, file, md5, market };
    }
    const downloaded = await this.bot.internal.getImage(image.file);
    return { url: image.url, file: downloaded.file, md5 };
  }

  async addFavoriteSticker(image: StickerImage): Promise<void> {
    const result = await this.bot.internal.addCustomFace({
      file: image.file,
      md5: image.md5,
      is_mark_face: image.market !== undefined,
      ...(image.market && {
        emoji_id: image.market.emojiId,
        package_id: image.market.packageId,
        file_name: `${image.market.emojiId}.gif`,
      }),
    });
    if (result.result !== 0) {
      throw new Error(`QQ 收藏失败：${result.errMsg}`);
    }
  }

  async deleteFavoriteSticker(resId: string): Promise<void> {
    const result = await this.bot.internal.deleteCustomFace(resId);
    if (result.result !== 0) {
      throw new Error(`QQ 收藏删除失败：${result.errMsg}`);
    }
    let count = 31;
    while (true) {
      const favorites = await this.fetchFavoriteStickers(count);
      if (favorites.some((favorite) => favorite.resId === resId)) {
        throw new Error("QQ 返回删除成功，但回查收藏仍存在");
      }
      if (favorites.length < count) {
        break;
      }
      count *= 2;
    }
  }

  async sendSticker(channelId: string, sticker: Sticker): Promise<IncomingMessage[]> {
    const annotation = sticker.annotation!;
    const element = sticker.market
      ? h("mface", {
          emojiId: sticker.market.emojiId,
          emojiPackageId: sticker.market.packageId,
          key: sticker.market.key!,
          summary: annotation.description,
        })
      : h("image", { src: sticker.url, summary: annotation.description, subType: 1 });
    const sent = await this.bot.createMessage(channelId, [element], channelId);
    if (!sent.length) {
      throw new Error("OneBot 未返回发送成功的表情消息");
    }
    // 记录发送时的语义快照，后续修改或删除收藏不会改写过去的消息。
    const content = h("image", {
      src: sticker.url,
      mediaType: "sticker",
      stickerId: annotation.id,
      stickerType: sticker.market ? "market" : "custom",
      description: annotation.description,
      tags: annotation.tags.join(","),
    }).toString();
    return sent.map((message) => ({
      kind: "message",
      id: message.id!,
      senderId: this.config.self_id,
      senderName: this.characterName,
      timestamp: message.timestamp!,
      isSelf: true,
      content,
    }));
  }

  async sendText(channelId: string, text: string, target: ReplyTarget): Promise<IncomingMessage[]> {
    const elements: h[] = [];
    if (target.quoteMessageId) {
      elements.push(h("quote", { id: target.quoteMessageId }));
    }
    if (target.senderId) {
      elements.push(h.at(target.senderId));
    }
    const textElement = h.text(target.senderId ? ` ${text}` : text);
    elements.push(textElement);

    // 使用平台返回的 ID 和时间记录发送事实，不在请求前生成占位消息。
    const sent = await this.bot.createMessage(channelId, elements, channelId);
    if (!sent.length) {
      throw new Error("OneBot 未返回发送成功的消息");
    }
    return sent.map((message) => ({
      kind: "message",
      id: message.id!,
      senderId: this.config.self_id,
      senderName: this.characterName,
      timestamp: message.timestamp!,
      isSelf: true,
      content: [...(target.senderId ? [h.at(target.senderId)] : []), textElement].join(""),
      ...(target.quoteMessageId && { quote: { id: target.quoteMessageId } }),
      ...(target.senderId && { mentionedSenderId: target.senderId }),
    }));
  }

  async poke(channelId: string, senderId: string): Promise<IncomingPoke> {
    await this.bot.internal.groupPoke(channelId, senderId);
    // 戳一戳没有平台消息 ID，调用完成后记录为独立事件。
    return {
      kind: "poke",
      senderId: this.config.self_id,
      senderName: this.characterName,
      timestamp: Date.now(),
      isSelf: true,
      targetSenderId: senderId,
    };
  }
}
