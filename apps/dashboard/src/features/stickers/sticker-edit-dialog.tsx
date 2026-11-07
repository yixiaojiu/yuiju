import {
  type ManagedSticker,
  stickerAnnotationSchema,
} from "@yuiju/shared/character-runtime/protocol";
import { Button } from "@yuiju/shared/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import { useState } from "react";

const inputStyle = "w-full rounded-lg border bg-background px-3 py-2 text-sm";

export function StickerEditDialog({
  sticker,
  characterId,
  onClose,
  onSaved,
}: {
  sticker: ManagedSticker;
  characterId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState(sticker.annotation?.id ?? "");
  const [description, setDescription] = useState(sticker.annotation?.description ?? "");
  const [tags, setTags] = useState(sticker.annotation?.tags.join("，") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const parsed = stickerAnnotationSchema.safeParse({
      id,
      description,
      tags: tags.split(/[,，]/).map((tag) => tag.trim()),
    });
    if (!parsed.success) {
      setError("请填写 ID、描述和标签；标签用逗号分隔，不能包含括号、换行或 NO_REPLY");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/stickers/${encodeURIComponent(sticker.resId)}/annotation?characterId=${encodeURIComponent(characterId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } catch {
      setError("连接中断，保存结果未确认，请刷新列表查看");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>编辑表情</SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await save();
          }}
        >
          <label className="grid gap-1.5 text-sm">
            ID
            <input
              className={inputStyle}
              required
              value={id}
              onChange={(event) => setId(event.target.value)}
              disabled={saving}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            描述
            <textarea
              className={`${inputStyle} min-h-28`}
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={saving}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            标签
            <input
              className={inputStyle}
              required
              placeholder="开心，惊讶"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              disabled={saving}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
