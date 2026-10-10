"use client";

import { useState } from "react";
import type { PersonProfile } from "@/app/api/[[...route]]/routes/memories";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { ExperiencesPanel } from "@/features/memories/experiences-panel";
import { formatTime } from "@/lib/date";
import { useQuery } from "@/lib/use-query";

const panel = "rounded-2xl border border-border/80 bg-card p-6 shadow-sm";

function People() {
  const { data, error } = useQuery<{ people: PersonProfile[] }>("/api/memories/people");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) {
    return <QueryState error={error} />;
  }
  const people = data.people.filter((person) =>
    `${person.name} ${person.userId} ${person.facts} ${person.impressions}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const current = people.find((person) => `${person.platform}:${person.userId}` === selected);
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
        <MonacoEditorPanel
          key={`${current.platform}:${current.userId}`}
          language="json"
          value={JSON.stringify(current, null, 2)}
        />
      ) : (
        <div className={`${panel} py-20 text-center text-sm text-muted-foreground`}>选择人物</div>
      )}
    </div>
  );
}

function SelfCognition() {
  const { data, error } = useQuery<{ text: string; updatedAt: number | null }>(
    "/api/memories/self-cognition",
  );
  if (!data) {
    return <QueryState error={error} />;
  }
  return (
    <article className="space-y-3">
      {data.updatedAt !== null && (
        <p className="mb-4 text-xs text-muted-foreground">{formatTime(data.updatedAt, true)}</p>
      )}
      <MonacoEditorPanel language="markdown" value={data.text} />
    </article>
  );
}

export function MemoriesPage({ publicDeployment }: { publicDeployment: boolean }) {
  const [tab, setTab] = useState("experiences");
  const tabs = publicDeployment
    ? { experiences: "经历记忆" }
    : { experiences: "经历记忆", people: "人物画像", self: "自我认知" };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">记忆</h1>
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
        <ExperiencesPanel />
      ) : tab === "people" ? (
        <People />
      ) : (
        <SelfCognition />
      )}
    </div>
  );
}
