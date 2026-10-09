import { Context, HTTP, h, type Session } from "@satorijs/core";
import { OneBotBot } from "@yuiju/satorijs-adapter-onebot/bot";
import type { Config } from "@yuiju/shared/config/schema";
import { logger } from "@yuiju/shared/logger/logger";
import type { IncomingEvent, IncomingMessage, IncomingPoke, ReplyTarget } from "./message";

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
    id: session.messageId!,
    senderId: session.userId!,
    senderName: session.author.name!,
    timestamp: session.timestamp,
    isSelf: false,
    content: session.content!,
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
    senderId: session.userId!,
    senderName: session.author.name!,
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
    this.bot = new OneBotBot(context, {
      protocol: "ws",
      selfId: this.config.self_id,
      endpoint: this.config.endpoint,
      token: this.config.token,
      retryTimes: 6,
      retryInterval: 5_000,
      retryLazy: 60_000,
      responseTimeout: 120_000,
    });

    const receive = async (session: Session) => {
      // 平台入口先限定接收范围，白名单外的事件不能创建会话或写入历史。
      if (
        !this.accepting ||
        !session.guildId ||
        !this.config.group_white_list?.includes(session.guildId) ||
        session.userId === this.config.self_id
      ) {
        return;
      }

      try {
        const message =
          session.type === "message-created" ? readOneBotMessage(session) : readOneBotPoke(session);
        if (message.kind === "poke" && message.targetSenderId !== this.config.self_id) {
          return;
        }
        logger.info("QQ 群事件已接收", {
          sender: message.senderName,
          kind: message.kind,
          content: message.kind === "message" ? message.content : "戳了戳角色",
        });
        await onMessage(session.channelId!, message);
      } catch (error) {
        logger.error("角色群聊接入失败", { error });
      }
    };

    // Satori 将 message 别名规范化为 message-created；notice 入口只放行戳一戳。
    context.on("message-created", receive);
    context.on("internal/session", async (session) => {
      if (session.type === "notice" && session.subtype === "poke") {
        await receive(session);
      }
    });
    this.accepting = true;
    await context.start();
  }

  stopReceiving() {
    // 先关闭入口但保留连接，让已经决定的发送流程完成后再 stop。
    this.accepting = false;
  }

  async stop() {
    await this.context?.stop();
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
