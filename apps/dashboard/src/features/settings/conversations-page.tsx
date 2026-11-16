"use client";

import { Switch } from "@yuiju/shared/ui/components/switch";
import { useState } from "react";
import type { ConversationSettingsResponse } from "@/app/api/[[...route]]/routes/conversation-settings";
import { QueryState } from "@/components/query-state";
import { useQuery } from "@/lib/use-query";

export function ConversationsPage() {
  const { data, error } = useQuery<ConversationSettingsResponse>("/api/settings/conversations");
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">会话</h1>
        <p className="mt-1 text-sm text-muted-foreground">控制角色是否参与各个 QQ 群的聊天。</p>
      </header>
      {!data ? (
        <QueryState error={error} />
      ) : data.characters.length === 0 ? (
        <p className="text-sm text-muted-foreground">未配置角色</p>
      ) : (
        data.characters.map((character) => (
          <section key={character.id} className="max-w-2xl rounded-2xl border bg-card">
            <header className="flex items-baseline justify-between px-5 py-4">
              <h2 className="text-sm font-semibold">{character.name}</h2>
              <span className="text-xs text-muted-foreground">
                {character.groups.length} 个群聊
              </span>
            </header>
            {character.groups.length === 0 ? (
              <p className="border-t px-5 py-6 text-center text-xs text-muted-foreground">
                未配置群聊
              </p>
            ) : (
              <ul className="divide-y border-t">
                {character.groups.map((group) => (
                  <ConversationRow key={group.groupId} characterId={character.id} group={group} />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function ConversationRow({
  characterId,
  group,
}: {
  characterId: string;
  group: { groupId: string; enabled: boolean };
}) {
  const [enabled, setEnabled] = useState(group.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(nextEnabled: boolean) {
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/settings/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, groupId: group.groupId, enabled: nextEnabled }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error);
      }
      setEnabled(body.enabled);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm">{group.groupId}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{enabled ? "参与聊天" : "不参与"}</span>
      <Switch
        aria-label={`QQ 群 ${group.groupId} 参与聊天`}
        checked={enabled}
        disabled={saving}
        onCheckedChange={save}
      />
    </li>
  );
}
