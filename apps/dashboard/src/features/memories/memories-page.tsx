"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import { useState } from "react";
import type { PersonMemoryFile } from "@/app/api/[[...route]]/routes/memories";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { ExperiencesPanel } from "@/features/memories/experiences-panel";
import { useQuery } from "@/lib/use-query";

const panel = "rounded-2xl border border-border/80 bg-card p-6 shadow-sm";

/** 两种记忆共用文件保存交互；正文原样提交，草稿由所属页面保留。 */
function MemoryFileEditor({
  value,
  language,
  onChange,
  saveUrl,
}: {
  value: string;
  language: "json" | "markdown";
  onChange: (value: string) => void;
  saveUrl: string;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    setFeedback(null);
    if (language === "json") {
      try {
        JSON.parse(value);
      } catch {
        setFeedback({ text: "JSON 格式错误，未保存", error: true });
        return;
      }
    }
    setSaving(true);
    try {
      const response = await fetch(saveUrl, {
        method: "PUT",
        headers: {
          "Content-Type": language === "json" ? "application/json" : "text/plain; charset=utf-8",
        },
        body: value,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error);
      }
      setFeedback({ text: "已保存", error: false });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        {feedback && (
          <p
            role={feedback.error ? "alert" : "status"}
            className={`text-sm ${feedback.error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
      <MonacoEditorPanel
        language={language}
        value={value}
        onChange={
          saving
            ? undefined
            : (content) => {
                setFeedback(null);
                onChange(content);
              }
        }
      />
    </div>
  );
}

function People({ characterId }: { characterId: string }) {
  const { data, error } = useQuery<{ people: PersonMemoryFile[] }>(
    `/api/memories/people?${new URLSearchParams({ characterId })}`,
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!data) {
    return <QueryState error={error} />;
  }
  const people = data.people.filter((person) =>
    `${person.name} ${person.userId} ${person.content}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const current = data.people.find((person) => `${person.platform}:${person.userId}` === selected);
  return (
    <div className="grid items-start gap-5 md:grid-cols-[240px_1fr]">
      <aside className={`${panel} space-y-3`}>
        <input
          aria-label="搜索人物"
          placeholder="搜索人物"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
        <div className="max-h-[65vh] space-y-1 overflow-y-auto">
          {people.map((person) => {
            const id = `${person.platform}:${person.userId}`;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                onClick={() => setSelected(id)}
                className={`w-full rounded-xl px-3 py-3 text-left text-sm ${selected === id ? "bg-accent" : "hover:bg-secondary"}`}
              >
                <p className="font-medium">{person.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {person.platform === "onebot" ? "QQ" : person.platform} · {person.userId}
                </p>
              </button>
            );
          })}
          {people.length === 0 && <p className="p-3 text-sm text-muted-foreground">暂无记录</p>}
        </div>
      </aside>
      {current ? (
        <MemoryFileEditor
          key={`${current.platform}:${current.userId}`}
          language="json"
          value={drafts[selected!] ?? current.content}
          onChange={(content) => setDrafts((previous) => ({ ...previous, [selected!]: content }))}
          saveUrl={`/api/memories/people?${new URLSearchParams({ characterId, platform: current.platform, userId: current.userId })}`}
        />
      ) : (
        <div className={`${panel} py-20 text-center text-sm text-muted-foreground`}>选择人物</div>
      )}
    </div>
  );
}

function SelfCognition({ characterId }: { characterId: string }) {
  const { data, error } = useQuery<{ text: string }>(
    `/api/memories/self-cognition?${new URLSearchParams({ characterId })}`,
  );
  const [draft, setDraft] = useState<string>();
  if (!data) {
    return <QueryState error={error} />;
  }
  return (
    <MemoryFileEditor
      language="markdown"
      value={draft ?? data.text}
      onChange={setDraft}
      saveUrl={`/api/memories/self-cognition?${new URLSearchParams({ characterId })}`}
    />
  );
}

export function MemoriesPage({
  characters,
  publicDeployment,
}: {
  characters: CharacterOption[];
  publicDeployment: boolean;
}) {
  const [characterId, setCharacterId] = useState(characters[0]?.id);
  if (characterId === undefined) {
    return <p className="text-sm text-muted-foreground">未配置角色</p>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">记忆</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </div>
      <MemoriesQuery
        key={characterId}
        characterId={characterId}
        publicDeployment={publicDeployment}
      />
    </div>
  );
}

function MemoriesQuery({
  characterId,
  publicDeployment,
}: {
  characterId: string;
  publicDeployment: boolean;
}) {
  const [tab, setTab] = useState("experiences");
  const tabs = publicDeployment
    ? { experiences: "经历记忆" }
    : { experiences: "经历记忆", people: "人物画像", self: "自我认知" };
  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b pb-3">
        {Object.entries(tabs).map(([value, label]) => (
          <Button
            key={value}
            variant={tab === value ? "secondary" : "ghost"}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "experiences" ? (
        <ExperiencesPanel characterId={characterId} />
      ) : tab === "people" ? (
        <People characterId={characterId} />
      ) : (
        <SelfCognition characterId={characterId} />
      )}
    </div>
  );
}
