import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { h } from "@satorijs/core";
import type { CustomFace } from "@yuiju/satorijs-adapter-onebot/types";
import type { ManagedSticker, StickerAnnotation } from "@yuiju/shared/character-runtime/protocol";
import { z } from "zod";
import type { IncomingMessage } from "../message";
import type { OneBotConnection } from "../onebot";
import { StickerImages } from "./images";
import {
  type collectStickerSchema,
  type MarketSticker,
  type PendingSticker,
  type Sticker,
  type StickerImage,
  stickerSchema,
} from "./schema";

export const STICKER_LIMIT = 30;

/** HTTP 入口据此返回领域拒绝，不把平台或磁盘异常误报成参数错误。 */
export class StickerCollectionError extends Error {
  constructor(
    readonly code: "not_found" | "duplicate_id" | "image_not_ready",
    message: string,
  ) {
    super(message);
  }
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
  private readonly images: StickerImages;

  constructor(
    private readonly filePath: string,
    private readonly platform: StickerPlatform,
  ) {
    this.images = new StickerImages(
      join(dirname(filePath), basename(filePath, ".json"), "images"),
      async (resId, data, contentType, signal) => {
        await this.mutate(async () => {
          // 下载期间可能取消收藏；取消信号在取得修改队列后再次生效。
          if (signal.aborted) {
            return;
          }
          const record = this.requireRecord(resId);
          await this.images.write(resId, data);
          record.imageContentType = contentType;
          await this.save();
        });
      },
    );
  }

  /** 管理列表包含不可发送收藏；等待已有修改提交，不隐式访问 QQ 或下载图片。 */
  async listForManagement(): Promise<ManagedSticker[]> {
    await this.mutationQueue;
    return this.records.map((record) => ({
      resId: record.resId,
      type: record.market ? "market" : "custom",
      ...(record.annotation && {
        annotation: { ...record.annotation, tags: [...record.annotation.tags] },
      }),
      firstSeenAt: record.firstSeenAt,
      lastSentAt: record.lastSentAt,
      sendCount: record.sendCount,
      status: !record.annotation
        ? "unannotated"
        : isSendable(record)
          ? "sendable"
          : "missing_send_info",
      imageStatus: this.images.status(record.resId),
    }));
  }

  async updateAnnotation(resId: string, annotation: StickerAnnotation): Promise<void> {
    await this.mutate(async () => {
      const record = this.requireRecord(resId);
      if (
        this.records.some((other) => other !== record && other.annotation?.id === annotation.id)
      ) {
        throw new StickerCollectionError("duplicate_id", `表情 ID 已被使用：${annotation.id}`);
      }
      record.annotation = annotation;
      await this.save();
    });
  }

  async remove(resId: string): Promise<void> {
    await this.mutate(async () => {
      this.requireRecord(resId);
      await this.platform.deleteFavoriteSticker(resId);
      this.records = this.records.filter((record) => record.resId !== resId);
      try {
        await this.save();
        await this.images.remove(resId);
      } catch (error) {
        throw new Error("QQ 取消收藏已确认，本地记录或图片清理失败，请重新同步", { cause: error });
      }
    });
  }

  async readImage(resId: string): Promise<{ data: Uint8Array; contentType: string }> {
    await this.mutationQueue;
    const record = this.requireRecord(resId);
    if (this.images.status(resId) !== "ready") {
      throw new StickerCollectionError("image_not_ready", "图片尚未就绪，请刷新状态或手动同步");
    }
    return { data: await this.images.read(resId), contentType: record.imageContentType! };
  }

  /** 所有发送与管理请求停止后调用，取消图片下载并等待在途提交结束。 */
  async stop(): Promise<void> {
    await this.images.stop();
    await this.mutationQueue;
  }

  private requireRecord(resId: string): Sticker {
    const record = this.records.find((item) => item.resId === resId);
    if (!record) {
      throw new StickerCollectionError("not_found", "该表情收藏已不存在");
    }
    return record;
  }

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
      try {
        await this.refresh();
        await this.save();
        await this.evict();
        await this.images.clean(this.records);
      } finally {
        this.images.schedule(this.records, true);
      }
    });
  }

  async collect(input: z.infer<typeof collectStickerSchema>, channelId: string) {
    return await this.mutate(async () => {
      try {
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
      } finally {
        this.images.schedule(this.records, false);
      }
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
    for (const previous of this.records) {
      if (!favorites.some((favorite) => favorite.resId === previous.resId)) {
        await this.images.remove(previous.resId);
      }
    }
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
        ...(existing?.imageContentType !== undefined && {
          imageContentType: existing.imageContentType,
        }),
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
      await this.images.remove(record.resId);
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
