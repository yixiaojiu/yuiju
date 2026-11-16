"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import { cn } from "@yuiju/shared/ui/utils";
import { useState } from "react";
import type { PersonMemoryFile } from "@/app/api/[[...route]]/routes/memories";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { SearchInput } from "@/components/search-input";
import { SegmentedControl } from "@/components/segmented-control";
import { ExperiencesPanel } from "@/features/memories/experiences-panel";
import { useQuery } from "@/lib/use-query";

/** 两种记忆共用文件保存交互；正文原样提交，草稿与已保存内容由所属页面保留。 */
function MemoryFileEditor({
  title,
  value,
  savedValue,
  language,
  onChange,
  onSaved,
  saveUrl,
}: {
  title: string;
  value: string;
  /** 最近一次加载或保存成功的内容，用于判断是否有未保存修改。 */
  savedValue: string;
  language: "json" | "markdown";
  onChange: (value: string) => void;
  onSaved: (value: string) => void;
  saveUrl: string;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const dirty = value !== savedValue;

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
      onSaved(value);
      setFeedback({ text: "已保存", error: false });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        {feedback ? (
          <p
            role={feedback.error ? "alert" : "status"}
            className={cn("text-xs", feedback.error ? "text-destructive" : "text-muted-foreground")}
          >
            {feedback.text}
          </p>
        ) : (
          dirty && <p className="text-xs text-amber-600">有未保存的修改</p>
        )}
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存"}
        </Button>
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
  /** 本页保存成功后的内容，覆盖初次加载的内容。 */
  const [saved, setSaved] = useState<Record<string, string>>({});
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
    <div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded-2xl border bg-card p-2">
        <SearchInput
          aria-label="搜索人物"
          placeholder="搜索人物"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-2 grid max-h-[calc(100dvh-16rem)] gap-0.5 overflow-y-auto">
          {people.map((person) => {
            const id = `${person.platform}:${person.userId}`;
            const dirty = drafts[id] !== undefined && drafts[id] !== (saved[id] ?? person.content);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                onClick={() => setSelected(id)}
                className={cn(
                  "rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected === id ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{person.name}</span>
                  {dirty && (
                    <span
                      role="img"
                      aria-label="有未保存的修改"
                      className="size-1.5 shrink-0 rounded-full bg-amber-500"
                    />
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {person.platform === "onebot" ? "QQ" : person.platform} · {person.userId}
                </p>
              </button>
            );
          })}
          {people.length === 0 && (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">暂无记录</p>
          )}
        </div>
      </aside>
      {current ? (
        <MemoryFileEditor
          key={selected}
          title={current.name}
          language="json"
          value={drafts[selected!] ?? saved[selected!] ?? current.content}
          savedValue={saved[selected!] ?? current.content}
          onChange={(content) => setDrafts((previous) => ({ ...previous, [selected!]: content }))}
          onSaved={(content) => setSaved((previous) => ({ ...previous, [selected!]: content }))}
          saveUrl={`/api/memories/people?${new URLSearchParams({ characterId, platform: current.platform, userId: current.userId })}`}
        />
      ) : (
        <div className="rounded-2xl border border-dashed py-20 text-center text-sm text-muted-foreground">
          从左侧选择人物
        </div>
      )}
    </div>
  );
}

function SelfCognition({ characterId }: { characterId: string }) {
  const { data, error } = useQuery<{ text: string }>(
    `/api/memories/self-cognition?${new URLSearchParams({ characterId })}`,
  );
  const [draft, setDraft] = useState<string>();
  const [saved, setSaved] = useState<string>();
  if (!data) {
    return <QueryState error={error} />;
  }
  return (
    <MemoryFileEditor
      title="自我认知"
      language="markdown"
      value={draft ?? saved ?? data.text}
      savedValue={saved ?? data.text}
      onChange={setDraft}
      onSaved={setSaved}
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">记忆</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </header>
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
  const [tab, setTab] = useState<"experiences" | "people" | "self">("experiences");
  return (
    <div className="space-y-4">
      {!publicDeployment && (
        <SegmentedControl
          label="记忆类型"
          value={tab}
          options={[
            { value: "experiences", label: "经历记忆" },
            { value: "people", label: "人物画像" },
            { value: "self", label: "自我认知" },
          ]}
          onChange={setTab}
        />
      )}
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
