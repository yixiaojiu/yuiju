import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { h } from "@satorijs/core";
import type { CustomFace } from "@yuiju/satorijs-adapter-onebot/types";
import { tool } from "ai";
import { z } from "zod";
import type { IncomingMessage } from "./message";
import type { OneBotConnection } from "./onebot";

export const STICKER_LIMIT = 30;

const annotationSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .min(1)
    .describe("你为表情命名的简短可读 ID，在当前角色和 QQ 账号的收藏中唯一。"),
  description: z.string().trim().min(1).describe("你看图后对画面内容和表达含义的简短描述。"),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .refine((tag) => !/[[\]\r\n]/.test(tag) && tag !== "NO_REPLY"),
    )
    .min(1)
    .transform((tags) => [...new Set(tags)])
    .describe("你为表情选择的情绪、语气或场景标签，不含括号、换行或 NO_REPLY。"),
});
const marketSchema = z.strictObject({
  emojiId: z.string().min(1),
  packageId: z.number().int(),
  key: z.string().min(1).optional(),
});
const stickerSchema = z.strictObject({
  resId: z.string().min(1),
  md5: z.string().min(1),
  url: z.string().url(),
  market: marketSchema.optional(),
  annotation: annotationSchema.optional(),
  firstSeenAt: z.number(),
  lastSentAt: z.number().optional(),
  sendCount: z.number().int().nonnegative(),
});

export type Sticker = z.infer<typeof stickerSchema>;
export type MarketSticker = z.infer<typeof marketSchema>;
export type StickerImage = { url: string; file: string; md5: string; market?: MarketSticker };
export type PendingSticker = { resId: string; url: string };

export const collectStickerSchema = annotationSchema.extend({
  source: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("message").describe("你从当前群聊中选择图片，收藏到 QQ 并保存标注。"),
      messageId: z.string().min(1).describe("你选择的本群真实消息 ID。"),
      imageIndex: z
        .number()
        .int()
        .nonnegative()
        .describe("你选择的图片在该消息全部图片中的序号，从 0 开始。"),
    }),
    z.strictObject({
      type: z.literal("favorite").describe("你为待标注事件中的已有 QQ 收藏补充标注，不重复收藏。"),
      resId: z.string().min(1).describe("你从待标注事件中取得的 QQ 收藏 resId。"),
    }),
  ]),
});
export const sendMediaSchema = z.strictObject({
  type: z.literal("sticker").describe("你要发送的媒体类型，目前仅支持收藏表情 sticker。"),
  id: z.string().min(1).describe("你从 listStickers 返回的目录中选择的表情 ID。"),
});

export const stickerTools = {
  collectSticker: tool({
    description:
      "你想收藏看过的表情，或为待标注收藏补充唯一 ID、描述和标签时调用。已有完整记录会返回原记录，不覆盖标注。",
    inputSchema: collectStickerSchema,
  }),
  listStickers: tool({
    description: "你需要选择表情时调用，返回当前可发送收藏的 ID、描述和标签。",
    inputSchema: z.strictObject({}),
  }),
  sendMedia: tool({
    description:
      "你想直接发送一张收藏表情时调用，按 ID 精确发送，返回实际发送结果。结果未确认时，不要重复执行。",
    inputSchema: sendMediaSchema,
  }),
};

/** 清理所有表情控制片段，仅保留第一个完整且可用的标签。 */
export function parseStickerReply(
  content: string,
  availableTags: readonly string[],
): { text: string; tag?: string } {
  let tag: string | undefined;
  // 残缺片段清理到右括号、下一个左括号或行尾，不跨行吞掉正文。
  const text = content
    .replace(/\[{2,}[^[\]\r\n]*(?:\]+|(?=\[|\r|\n|$))|\]{2,}/g, (fragment) => {
      const match = /^\[\[([^[\]\r\n]+)\]\]$/.exec(fragment);
      if (
        tag === undefined &&
        match &&
        match[1] !== "NO_REPLY" &&
        availableTags.includes(match[1])
      ) {
        tag = match[1];
      }
      return "";
    })
    .trim();
  return tag === undefined ? { text } : { text, tag };
}

function isSendable(sticker: Sticker): boolean {
  return (
    sticker.annotation !== undefined &&
    (sticker.market === undefined || sticker.market.key !== undefined)
  );
}

type StickerPlatform = Pick<
  OneBotConnection,
  | "fetchFavoriteStickers"
  | "addFavoriteSticker"
  | "deleteFavoriteSticker"
  | "resolveStickerImage"
  | "sendSticker"
>;

/** 同一角色与 QQ 账号共享；队列覆盖平台变更、发送确认和文件提交。 */
export class StickerCollection {
  private records: Sticker[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly platform: StickerPlatform,
  ) {}

  async initialize(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // 首次启动尚无元数据文件，收藏事实从 QQ 获取。
      await this.synchronize();
      return;
    }
    this.records = z.array(stickerSchema).parse(JSON.parse(content));
    const ids = this.records.flatMap((sticker) =>
      sticker.annotation ? [sticker.annotation.id] : [],
    );
    if (
      new Set(ids).size !== ids.length ||
      new Set(this.records.map((sticker) => sticker.resId)).size !== this.records.length
    ) {
      throw new Error("表情元数据中存在重复 ID 或 QQ 收藏标识");
    }
    await this.synchronize();
  }

  list() {
    return this.records.filter(isSendable).map((sticker) => ({ ...sticker.annotation! }));
  }

  pending(): PendingSticker[] {
    return this.records
      .filter((sticker) => !sticker.annotation)
      .map(({ resId, url }) => ({ resId, url }));
  }

  async synchronize(): Promise<void> {
    await this.mutate(async () => {
      await this.refresh();
      await this.save();
      await this.evict();
    });
  }

  async collect(input: z.infer<typeof collectStickerSchema>, channelId: string) {
    return await this.mutate(async () => {
      await this.refresh();
      await this.save();
      let record: Sticker;
      let image: StickerImage | undefined;
      if (input.source.type === "favorite") {
        const resId = input.source.resId;
        const favorite = this.records.find((sticker) => sticker.resId === resId);
        if (!favorite) {
          throw new Error("该 QQ 收藏已不存在");
        }
        record = favorite;
      } else {
        image = await this.platform.resolveStickerImage(
          channelId,
          input.source.messageId,
          input.source.imageIndex,
        );
        const existing = this.findImage(image);
        if (existing?.annotation) {
          if (image.market) {
            existing.market = image.market;
            await this.save();
          }
          return { status: "existing", ...existing.annotation };
        }
        const conflict = this.records.find((sticker) => sticker.annotation?.id === input.id);
        if (conflict && conflict !== existing) {
          throw new Error(`表情 ID 已被使用：${input.id}`);
        }
        if (!existing) {
          await this.platform.addFavoriteSticker(image);
          try {
            await this.refresh();
          } catch (error) {
            throw new Error(
              `QQ 收藏请求已成功，但回查失败：${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
        const collected = this.findImage(image);
        if (!collected) {
          throw new Error("QQ 收藏操作已完成，但回查未找到目标表情");
        }
        record = collected;
      }
      if (record.annotation) {
        return { status: "existing", ...record.annotation };
      }
      if (
        this.records.some((sticker) => sticker !== record && sticker.annotation?.id === input.id)
      ) {
        throw new Error(`表情 ID 已被使用：${input.id}`);
      }
      record.annotation = { id: input.id, description: input.description, tags: input.tags };
      if (image?.market) {
        record.market = image.market;
      }
      try {
        await this.save();
      } catch (error) {
        throw new Error(
          `QQ 收藏已存在，但本地标注保存失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      try {
        await this.evict();
      } catch (error) {
        throw new Error(
          `表情已登记，但超限清理失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return { status: "collected", ...record.annotation, sendable: isSendable(record) };
    });
  }

  /** 收到商城消息时补齐原生发送标识，不保存群或消息来源。 */
  async observeMessage(content: string): Promise<void> {
    for (const element of h.parse(content)) {
      if (element.type === "image" && element.attrs.emojiId && element.attrs.key) {
        await this.observeMarketSticker({
          emojiId: String(element.attrs.emojiId),
          packageId: Number(element.attrs.emojiPackageId),
          key: String(element.attrs.key),
        });
      }
    }
  }

  async observeMarketSticker(market: MarketSticker): Promise<void> {
    await this.mutate(async () => {
      const record = this.records.find(
        (sticker) =>
          sticker.market?.emojiId === market.emojiId &&
          sticker.market.packageId === market.packageId,
      );
      if (record && record.market?.key !== market.key) {
        record.market = market;
        await this.save();
      }
    });
  }

  async send(
    channelId: string,
    selector: { id: string } | { tag: string },
    beforeSend: () => Promise<void>,
    recordSent: (messages: IncomingMessage[]) => Promise<void>,
  ): Promise<void> {
    await this.mutate(async () => {
      let record: Sticker | undefined;
      if ("id" in selector) {
        record = this.records.find(
          (sticker) => sticker.annotation?.id === selector.id && isSendable(sticker),
        );
      } else {
        const matches = this.records.filter(
          (sticker) => isSendable(sticker) && sticker.annotation!.tags.includes(selector.tag),
        );
        record = matches[Math.floor(Math.random() * matches.length)];
      }
      if (!record) {
        if ("tag" in selector) {
          return;
        }
        throw new Error(`没有可发送的表情：${selector.id}`);
      }
      await beforeSend();
      const sent = await this.platform.sendSticker(channelId, record);
      try {
        await recordSent(sent);
      } finally {
        // 平台已确认成功；历史持久化失败也不能把这次使用记作未发送。
        record.lastSentAt = sent[0].timestamp;
        record.sendCount += 1;
        await this.save();
      }
    });
  }

  private findImage(image: StickerImage): Sticker | undefined {
    return this.records.find((sticker) =>
      image.market
        ? sticker.market?.emojiId === image.market.emojiId &&
          sticker.market.packageId === image.market.packageId
        : sticker.market === undefined && sticker.md5.toLowerCase() === image.md5.toLowerCase(),
    );
  }

  private async refresh(): Promise<void> {
    let count = STICKER_LIMIT + 1;
    let favorites: CustomFace[];
    while (true) {
      favorites = await this.platform.fetchFavoriteStickers(count);
      if (favorites.length < count) {
        break;
      }
      count *= 2;
    }
    const now = Date.now();
    this.records = favorites.map((favorite) => {
      const existing = this.records.find((sticker) => sticker.resId === favorite.resId);
      const market = favorite.isMarkFace
        ? {
            emojiId: favorite.eId,
            packageId: Number(favorite.epId),
            ...(existing?.market?.key !== undefined && { key: existing.market.key }),
          }
        : undefined;
      return {
        resId: favorite.resId,
        md5: favorite.md5,
        url: favorite.url,
        firstSeenAt: existing ? existing.firstSeenAt : now,
        sendCount: existing ? existing.sendCount : 0,
        ...(existing?.annotation && { annotation: existing.annotation }),
        ...(existing?.lastSentAt !== undefined && { lastSentAt: existing.lastSentAt }),
        ...(market && { market }),
      };
    });
  }

  private async evict(): Promise<void> {
    const candidates = [...this.records].sort(
      (left, right) =>
        (left.lastSentAt ?? left.firstSeenAt) - (right.lastSentAt ?? right.firstSeenAt) ||
        left.resId.localeCompare(right.resId),
    );
    for (const record of candidates.slice(0, Math.max(0, this.records.length - STICKER_LIMIT))) {
      await this.platform.deleteFavoriteSticker(record.resId);
      this.records = this.records.filter((sticker) => sticker.resId !== record.resId);
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(`${this.filePath}.tmp`, JSON.stringify(this.records, null, 2));
    await rename(`${this.filePath}.tmp`, this.filePath);
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
