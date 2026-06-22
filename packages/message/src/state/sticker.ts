import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { h } from "@satorijs/core";
import {
  buildStickerPromptSection,
  getYuijuConfig,
  getYuijuProjectRoot,
  type YuijuStickerConfig,
} from "@yuiju/utils";
import { logger } from "@/utils/logger";

export interface ResolvedSticker {
  /** 业务配置里的表情包唯一标识，供提示词和发送链路按 key 引用。 */
  key: string;
  /** 业务配置里的表情包说明文本，主要用于生成给 LLM 的可用表情包描述。 */
  description: string;
  /** 配置中声明的原始路径，保留它便于日志排查配置问题。 */
  originalUri: string;
  /** 基于项目根目录解析后的本地绝对路径，用于定位实际文件。 */
  absoluteUri: string;
  /** 启动时预读到内存里的图片内容，发送时直接复用，避免重复读文件。 */
  fileBuffer: Buffer;
}

const STICKER_TOKEN_REGEX = /\[\[sticker:([a-zA-Z0-9_-]+)\]\]/g;
export const YUIJU_STICKER_ELEMENT_ATTR = "yuijuStickerKey";

export class StickerState {
  private readonly registry = new Map<string, ResolvedSticker>();
  private promptSection: string | null = null;
  private hasInitialized = false;

  /**
   * 启动时预处理表情包配置，产出可复用的只读注册表。
   *
   * 说明：
   * - 只在消息服务启动阶段初始化一次，避免每次发送消息都重复解析路径；
   * - 无效项只记录日志并跳过，不阻塞服务启动；
   * - 成功加载的表情包会缓存到内存，供提示词与发送链路复用；
   * - 图片文件会在启动时直接读入内存，避免发送时再依赖本地路径格式。
   */
  public async initialize() {
    if (this.hasInitialized) {
      return;
    }

    this.hasInitialized = true;

    const projectRoot = getYuijuProjectRoot();
    const stickers = getYuijuConfig().message.stickers;
    const loadedKeys: string[] = [];

    for (const [key, value] of Object.entries(stickers)) {
      const resolvedSticker = await this.resolveStickerConfig({
        key,
        value,
        projectRoot,
      });

      if (!resolvedSticker) {
        continue;
      }

      this.registry.set(key, resolvedSticker);
      loadedKeys.push(key);
    }

    this.promptSection = this.buildPromptSection();

    if (!loadedKeys.length) {
      logger.warn("[message.sticker] 当前无可用表情包，LLM 不应输出 [[sticker:*]] 标记");
      return;
    }

    logger.info("[message.sticker] 已加载表情包", {
      count: loadedKeys.length,
      stickers: loadedKeys,
    });
  }

  public getByKey(key: string): ResolvedSticker | null {
    return this.registry.get(key) || null;
  }

  public list(): ResolvedSticker[] {
    return [...this.registry.values()];
  }

  public getPromptSection(): string {
    return this.promptSection ?? this.buildPromptSection();
  }

  /**
   * 生成给 LLM 使用的表情包提示词片段。
   *
   * 说明：
   * - 没有可用表情包时，会明确禁止模型输出 sticker 标记；
   * - 有可用表情包时，会列出 key 与说明，并强调一般放在回复末尾。
   */
  public buildPromptSection(): string {
    return buildStickerPromptSection(this.list());
  }

  public buildSatoriElementsFromLine(line: string): h[] {
    const elements: h[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(STICKER_TOKEN_REGEX)) {
      const fullMatch = match[0];
      const key = match[1];
      const startIndex = match.index ?? -1;

      if (startIndex < 0) {
        continue;
      }

      if (startIndex > lastIndex) {
        const text = line.slice(lastIndex, startIndex);
        if (text.trim()) {
          elements.push(h.text(text));
        }
      }

      const sticker = this.getByKey(key);
      if (!sticker) {
        logger.warn("[message.sticker] 命中未知或不可用表情包，降级为文本发送", {
          key,
          rawToken: fullMatch,
        });
        elements.push(h.text(fullMatch));
      } else {
        elements.push(
          h("image", {
            url: `base64://${sticker.fileBuffer.toString("base64")}`,
            summary: sticker.key,
            [YUIJU_STICKER_ELEMENT_ATTR]: sticker.key,
          }),
        );
      }

      lastIndex = startIndex + fullMatch.length;
    }

    if (lastIndex < line.length) {
      const text = line.slice(lastIndex);
      if (text.trim()) {
        elements.push(h.text(text));
      }
    }

    return elements;
  }

  private async resolveStickerConfig(input: {
    key: string;
    value: YuijuStickerConfig;
    projectRoot: string;
  }): Promise<ResolvedSticker | null> {
    const key = input.key.trim();
    const uri = input.value?.uri?.trim();
    const description = input.value?.description?.trim();

    if (!key || !uri || !description) {
      logger.warn("[message.sticker] 跳过无效表情包配置", {
        key: input.key,
        uri: input.value?.uri,
        description: input.value?.description,
        reason: "key、uri 或 description 为空",
      });
      return null;
    }

    const absoluteUri = resolve(input.projectRoot, uri);

    try {
      const fileBuffer = await readFile(absoluteUri);

      return {
        key,
        description,
        originalUri: uri,
        absoluteUri,
        fileBuffer,
      };
    } catch (error) {
      logger.warn("[message.sticker] 跳过不可读取的表情包文件", {
        key,
        uri,
        absoluteUri,
        error,
      });
      return null;
    }
  }
}

export const stickerState = new StickerState();
