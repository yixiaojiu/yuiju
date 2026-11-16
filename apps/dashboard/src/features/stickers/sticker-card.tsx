import type { ManagedSticker } from "@yuiju/shared/character-runtime/protocol";
import { Button } from "@yuiju/shared/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@yuiju/shared/ui/components/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import { cn } from "@yuiju/shared/ui/utils";
import { Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { formatTime } from "@/lib/date";

export const stickerStatusLabels = {
  sendable: "可发送",
  unannotated: "待标注",
  missing_send_info: "暂不可发送",
};
const statusDotStyles = {
  sendable: "bg-emerald-500",
  unannotated: "bg-amber-400",
  missing_send_info: "bg-muted-foreground/40",
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
  /** 返回是否删除成功；成功后关闭确认弹层。 */
  onRemove: () => Promise<boolean>;
}) {
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const imageUrl = `/api/stickers/${encodeURIComponent(sticker.resId)}/image?characterId=${encodeURIComponent(characterId)}`;
  const title = sticker.annotation?.id ?? "未标注";
  return (
    <>
      <article className="flex flex-col overflow-hidden rounded-2xl border bg-card">
        <button
          type="button"
          className="flex aspect-square w-full items-center justify-center bg-muted/60 p-3 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          disabled={sticker.imageStatus !== "ready"}
          onClick={() => setPreview(true)}
          aria-label={`查看表情 ${title}`}
        >
          {sticker.imageStatus === "ready" ? (
            <Image
              src={imageUrl}
              alt={sticker.annotation?.description ?? "收藏表情"}
              width={256}
              height={256}
              unoptimized
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {sticker.imageStatus === "failed" ? "图片下载失败" : "图片下载中…"}
            </span>
          )}
        </button>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span
              role="img"
              aria-label={stickerStatusLabels[sticker.status]}
              title={stickerStatusLabels[sticker.status]}
              className={cn("size-1.5 shrink-0 rounded-full", statusDotStyles[sticker.status])}
            />
            <span className="truncate">{title}</span>
          </p>
          {sticker.annotation && (
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">
              {sticker.annotation.description}
            </p>
          )}
          {sticker.annotation && sticker.annotation.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sticker.annotation.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-accent px-1.5 py-0.5 text-[11px]">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto flex items-center gap-1 pt-1">
            <span className="flex-1 text-xs text-muted-foreground">
              使用 {sticker.sendCount} 次
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="编辑"
              disabled={busy}
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Popover open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="取消收藏"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy}
                >
                  <Trash2 />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-3">
                <p className="text-sm">取消收藏「{title}」？</p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    保留
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await onRemove()) {
                        setConfirming(false);
                      }
                    }}
                  >
                    取消收藏
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </article>
      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
          <SheetHeader className="pr-12">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-8">
            <div className="flex aspect-square items-center justify-center rounded-xl bg-muted/60 p-4">
              <Image
                src={imageUrl}
                alt={sticker.annotation?.description ?? "收藏表情"}
                width={1024}
                height={1024}
                unoptimized
                className="h-full w-full object-contain"
              />
            </div>
            {sticker.annotation && (
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {sticker.annotation.description}
              </p>
            )}
            <dl className="divide-y border-y text-sm">
              {[
                ["状态", stickerStatusLabels[sticker.status]],
                ["类型", sticker.type === "market" ? "商城表情" : "自定义表情"],
                ["标签", sticker.annotation?.tags.join("、") || "—"],
                ["使用次数", String(sticker.sendCount)],
                ["首次记录", formatTime(sticker.firstSeenAt, true)],
                [
                  "最近使用",
                  sticker.lastSentAt === undefined ? "—" : formatTime(sticker.lastSentAt, true),
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-4 py-2.5">
                  <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 flex-1 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
