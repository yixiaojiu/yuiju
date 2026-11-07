"use client";

import type { ManagedSticker, StickersResponse } from "@yuiju/shared/character-runtime/protocol";
import { Button } from "@yuiju/shared/ui/components/button";
import { Card } from "@yuiju/shared/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import { useEffect, useState } from "react";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { StickerCard, stickerStatusLabels } from "./sticker-card";
import { StickerEditDialog } from "./sticker-edit-dialog";

export function StickersPage({ characters }: { characters: CharacterOption[] }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">表情收藏</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </div>
      {characterId ? (
        <StickerCollectionPanel key={characterId} characterId={characterId} />
      ) : (
        <p className="text-sm text-muted-foreground">未配置角色</p>
      )}
    </div>
  );
}

/** 每个角色独立保存页面状态，切换角色不会保留上一角色的编辑或删除操作。 */
function StickerCollectionPanel({ characterId }: { characterId: string }) {
  const [data, setData] = useState<StickersResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [tag, setTag] = useState("__all__");
  const [status, setStatus] = useState("__all__");
  const [editing, setEditing] = useState<ManagedSticker>();
  const [removing, setRemoving] = useState<ManagedSticker>();
  const query = `characterId=${encodeURIComponent(characterId)}`;
  const [request, setRequest] = useState({ url: `/api/stickers?${query}` });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(request.url, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error);
        }
        if (!controller.signal.aborted) {
          setData(result);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => controller.abort();
  }, [request]);

  async function runAction(method: "POST" | "DELETE", path: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/stickers${path}?${query}`, { method });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return false;
      }
      setRequest({ url: request.url });
      return true;
    } catch {
      setError("连接中断，执行结果未确认，请刷新列表或重新同步");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const tags = [
    ...new Set(data?.stickers.flatMap((sticker) => sticker.annotation?.tags ?? [])),
  ].sort();
  const search = keyword.trim().toLowerCase();
  const stickers = data?.stickers.filter(
    (sticker) =>
      (status === "__all__" || sticker.status === status) &&
      (tag === "__all__" || sticker.annotation?.tags.includes(tag)) &&
      (!search ||
        [
          sticker.annotation?.id,
          sticker.annotation?.description,
          ...(sticker.annotation?.tags ?? []),
        ].some((text) => text?.toLowerCase().includes(search))),
  );

  return (
    <div className="space-y-3.5">
      <Card className="rounded-2xl p-3.5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            关键词
            <input
              className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="ID、描述、标签"
            />
          </label>
          <label htmlFor="sticker-tag" className="grid gap-1.5 text-xs text-muted-foreground">
            标签
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger id="sticker-tag" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部</SelectItem>
                {tags.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label htmlFor="sticker-status" className="grid gap-1.5 text-xs text-muted-foreground">
            状态
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="sticker-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部</SelectItem>
                {Object.entries(stickerStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {data && `${data.stickers.length} / ${data.limit}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => setRequest({ url: request.url })}
            >
              刷新
            </Button>
            <Button disabled={busy || loading} onClick={() => runAction("POST", "/sync")}>
              {busy ? "处理中…" : "从 QQ 同步"}
            </Button>
          </div>
        </div>
      </Card>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && !data && (
        <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
      )}
      {!loading && stickers?.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">暂无表情</p>
      )}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stickers?.map((sticker) => (
          <StickerCard
            key={sticker.resId}
            sticker={sticker}
            characterId={characterId}
            busy={busy || loading}
            onEdit={() => setEditing(sticker)}
            onRemove={() => setRemoving(sticker)}
          />
        ))}
      </div>
      {editing && (
        <StickerEditDialog
          key={editing.resId}
          sticker={editing}
          characterId={characterId}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setRequest({ url: request.url });
          }}
        />
      )}
      <Sheet
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRemoving(undefined);
          }
        }}
      >
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>
              取消收藏{removing?.annotation ? `「${removing.annotation.id}」` : "此表情"}？
            </SheetTitle>
          </SheetHeader>
          <div className="flex justify-end gap-2 px-4">
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await runAction("DELETE", `/${encodeURIComponent(removing!.resId)}`)) {
                  setRemoving(undefined);
                }
              }}
            >
              确认
            </Button>
          </div>
          {error && (
            <p role="alert" className="px-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
