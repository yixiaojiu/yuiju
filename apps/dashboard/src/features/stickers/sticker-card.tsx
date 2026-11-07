import type { ManagedSticker } from "@yuiju/shared/character-runtime/protocol";
import { Button } from "@yuiju/shared/ui/components/button";
import { Card } from "@yuiju/shared/ui/components/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import Image from "next/image";
import { useState } from "react";
import { formatTime } from "@/lib/date";

export const stickerStatusLabels = {
  sendable: "可发送",
  unannotated: "待标注",
  missing_send_info: "暂不可发送",
};

export function StickerCard({
  sticker,
  characterId,
  busy,
  onEdit,
  onRemove,
}: {
  sticker: ManagedSticker;
  characterId: string;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const imageUrl = `/api/stickers/${encodeURIComponent(sticker.resId)}/image?characterId=${encodeURIComponent(characterId)}`;
  const title = sticker.annotation?.id ?? "未标注";
  return (
    <>
      <Card className="gap-3 overflow-hidden rounded-2xl p-3.5">
        <button
          type="button"
          className="flex h-44 w-full items-center justify-center rounded-xl bg-secondary/40"
          disabled={sticker.imageStatus !== "ready"}
          onClick={() => setPreview(true)}
          aria-label={`放大表情 ${title}`}
        >
          {sticker.imageStatus === "ready" ? (
            <Image
              src={imageUrl}
              alt={sticker.annotation?.description ?? "收藏表情"}
              width={256}
              height={176}
              unoptimized
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {sticker.imageStatus === "failed" ? "图片下载失败" : "图片下载中…"}
            </span>
          )}
        </button>
        <div className="min-w-0 space-y-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="break-all font-medium">{title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {stickerStatusLabels[sticker.status]}
            </span>
          </div>
          {sticker.annotation && (
            <p className="break-words text-xs text-muted-foreground">
              {sticker.annotation.description}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {sticker.annotation?.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                {tag}
              </span>
            ))}
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {sticker.type === "market" ? "商城表情" : "自定义表情"} · 使用 {sticker.sendCount} 次
            </p>
            <p>首次记录 {formatTime(sticker.firstSeenAt, true)}</p>
            <p>
              最近使用{" "}
              {sticker.lastSentAt === undefined ? "—" : formatTime(sticker.lastSentAt, true)}
            </p>
          </div>
        </div>
        <div className="mt-auto flex justify-end gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={busy}
            onClick={onRemove}
          >
            取消收藏
          </Button>
        </div>
      </Card>
      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent className="w-full sm:max-w-3xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-4">
            <Image
              src={imageUrl}
              alt={sticker.annotation?.description ?? "收藏表情"}
              width={1024}
              height={1024}
              unoptimized
              className="h-full w-full object-contain"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
