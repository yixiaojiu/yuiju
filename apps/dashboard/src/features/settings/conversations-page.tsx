"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@yuiju/shared/ui/components/card";
import { Switch } from "@yuiju/shared/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@yuiju/shared/ui/components/table";
import { useState } from "react";
import type { ConversationSettingsResponse } from "@/app/api/[[...route]]/routes/conversation-settings";
import { useQuery } from "@/lib/use-query";

export function ConversationsPage() {
  const { data, error } = useQuery<ConversationSettingsResponse>("/api/settings/conversations");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">会话设置</h1>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-muted-foreground">加载中…</p>}
      {data?.characters.length === 0 && <p className="text-sm text-muted-foreground">未配置角色</p>}
      {data?.characters.map((character) => (
        <Card key={character.id}>
          <CardHeader>
            <CardTitle>{character.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>QQ 群</TableHead>
                  <TableHead className="w-40 text-right">参与聊天</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {character.groups.map((group) => (
                  <ConversationRow key={group.groupId} characterId={character.id} group={group} />
                ))}
                {character.groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      未配置群聊
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
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
    <TableRow>
      <TableCell>
        {group.groupId}
        {error && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Switch
          aria-label={`QQ 群 ${group.groupId} 参与聊天`}
          checked={enabled}
          disabled={saving}
          onCheckedChange={save}
        />
      </TableCell>
    </TableRow>
  );
}
