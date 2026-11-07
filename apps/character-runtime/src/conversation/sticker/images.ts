import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StickerImageStatus } from "@yuiju/shared/character-runtime/protocol";
import { logger } from "@yuiju/shared/logger/logger";
import type { Sticker } from "./schema";

type ImageJob = {
  source: Pick<Sticker, "resId" | "url" | "imageContentType">;
  status: StickerImageStatus;
  controller: AbortController;
};

/** 单角色 QQ 收藏的后台图片任务；网络下载不占用收藏修改队列。 */
export class StickerImages {
  private readonly jobs = new Map<string, ImageJob>();
  private readonly pending: ImageJob[] = [];
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly directory: string,
    private readonly commit: (
      resId: string,
      data: Uint8Array,
      contentType: string,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {}

  status(resId: string): StickerImageStatus {
    return this.jobs.get(resId)!.status;
  }

  /** 失败任务只在显式同步时重新安排；同一收藏不会并发下载。 */
  schedule(records: readonly Sticker[], retryFailed: boolean): void {
    if (this.stopped) {
      return;
    }
    for (const source of records) {
      const previous = this.jobs.get(source.resId);
      if (previous && (previous.status === "pending" || !retryFailed)) {
        continue;
      }
      const job: ImageJob = {
        source: { resId: source.resId, url: source.url, imageContentType: source.imageContentType },
        status: "pending",
        controller: new AbortController(),
      };
      this.jobs.set(source.resId, job);
      this.pending.push(job);
    }
    if (this.pending.length) {
      this.running ??= this.run();
    }
  }

  private async run(): Promise<void> {
    try {
      while (this.pending.length && !this.stopped) {
        const job = this.pending.shift()!;
        if (job.controller.signal.aborted) {
          continue;
        }
        try {
          if (job.source.imageContentType !== undefined) {
            try {
              await access(this.path(job.source.resId));
              job.status = "ready";
              continue;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
              }
              // 同步负责补齐已缺失的图片；查询接口不会触发下载。
            }
          }
          const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(30_000)]);
          const response = await fetch(job.source.url, { signal });
          if (!response.ok) {
            throw new Error(`图片下载失败：HTTP ${response.status}`);
          }
          const contentType = response.headers.get("content-type");
          if (!contentType?.startsWith("image/")) {
            throw new Error("图片接口没有返回 image/* 类型");
          }
          const data = new Uint8Array(await response.arrayBuffer());
          await this.commit(job.source.resId, data, contentType, job.controller.signal);
          if (!job.controller.signal.aborted) {
            job.status = "ready";
          }
        } catch (error) {
          if (!job.controller.signal.aborted) {
            job.status = "failed";
            logger.warn("表情图片下载失败，等待手动同步", { error });
          }
        }
      }
    } finally {
      this.running = undefined;
    }
  }

  private path(resId: string): string {
    // 固定后缀使特殊 ID 也只能映射为目录内的普通文件名。
    return join(this.directory, `${encodeURIComponent(resId)}.image`);
  }

  async read(resId: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(resId)));
  }

  /** 由收藏模块持有修改队列时调用，图片与元数据一起提交。 */
  async write(resId: string, data: Uint8Array): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.path(resId);
    await writeFile(`${path}.tmp`, data);
    await rename(`${path}.tmp`, path);
  }

  async remove(resId: string): Promise<void> {
    this.jobs.get(resId)?.controller.abort();
    this.jobs.delete(resId);
    const pendingIndex = this.pending.findIndex((job) => job.source.resId === resId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
    }
    await rm(this.path(resId), { force: true });
  }

  /** 同步清理上次中断留下的临时文件及已不属于收藏的图片。 */
  async clean(records: readonly Sticker[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const names = new Set(records.map((record) => `${encodeURIComponent(record.resId)}.image`));
    for (const name of await readdir(this.directory)) {
      if (!names.has(name)) {
        await rm(join(this.directory, name));
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
    }
    this.pending.length = 0;
    await this.running;
  }
}
