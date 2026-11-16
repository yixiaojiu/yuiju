"use client";

import type { ManagedSticker, StickersResponse } from "@yuiju/shared/character-runtime/protocol";
import { Button } from "@yuiju/shared/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { QueryState } from "@/components/query-state";
import { SearchInput } from "@/components/search-input";
import { SegmentedControl } from "@/components/segmented-control";
import { StickerCard, stickerStatusLabels } from "./sticker-card";
import { StickerEditDialog } from "./sticker-edit-dialog";

export function StickersPage({ characters }: { characters: CharacterOption[] }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">表情收藏</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </header>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="w-full sm:w-56"
          aria-label="关键词"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索 ID、描述、标签"
        />
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-36 rounded-lg bg-card" aria-label="标签">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="__all__">全部标签</SelectItem>
            {tags.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SegmentedControl
          label="状态"
          value={status}
          options={[
            { value: "__all__", label: "全部" },
            ...Object.entries(stickerStatusLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={setStatus}
        />
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {data.stickers.length} / {data.limit}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新"
            disabled={busy || loading}
            onClick={() => setRequest({ url: request.url })}
          >
            <RotateCw />
          </Button>
          <Button size="sm" disabled={busy || loading} onClick={() => runAction("POST", "/sync")}>
            {busy ? "处理中…" : "从 QQ 同步"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && !data ? <QueryState /> : stickers?.length === 0 && <QueryState empty />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {stickers?.map((sticker) => (
          <StickerCard
            key={sticker.resId}
            sticker={sticker}
            characterId={characterId}
            busy={busy || loading}
            onEdit={() => setEditing(sticker)}
            onRemove={() => runAction("DELETE", `/${encodeURIComponent(sticker.resId)}`)}
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
    </div>
  );
}
