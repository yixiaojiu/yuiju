"use client";

import { useEffect, useMemo, useState } from "react";
import { FileTree } from "../file-browser/file-tree";
import { MonacoEditorPanel } from "../file-browser/monaco-editor-panel";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

type LogsService = "message" | "world";

const collectFirstFilePath = (nodes: FileTreeNode[]): string => {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const nested = collectFirstFilePath(node.children ?? []);
    if (nested) return nested;
  }
  return "";
};

export default function LogsPage() {
  const [service, setService] = useState<LogsService>("message");
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadTree = async () => {
      const response = await fetch(`/api/nodejs/files/tree?scope=logs&service=${service}`);
      const payload = await response.json();
      const nodes = (payload.data?.tree ?? []) as FileTreeNode[];
      setTree(nodes);
      setSelectedPath(collectFirstFilePath(nodes));
    };

    void loadTree();
  }, [service]);

  useEffect(() => {
    if (!selectedPath) {
      setContent("");
      return;
    }

    const loadContent = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/nodejs/files/content?scope=logs&service=${service}&path=${encodeURIComponent(selectedPath)}`,
        );
        const payload = await response.json();
        setContent(payload.data?.content ?? "");
        setLanguage(payload.data?.language ?? "plaintext");
      } finally {
        setLoading(false);
      }
    };

    void loadContent();
  }, [selectedPath, service]);

  const title = useMemo(() => {
    return service === "message" ? "日志查看器（message）" : "日志查看器（world）";
  }, [service]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-8 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2f47]">{title}</h1>
          <p className="mt-1 text-sm text-[#667791]">日志页只读，右侧编辑器不可保存。</p>
        </div>
        <select
          value={service}
          onChange={(event) => setService(event.target.value as LogsService)}
          className="rounded-lg border border-[#c8dbef] bg-white px-3 py-2 text-sm text-[#1f2f47]"
        >
          <option value="message">message logs</option>
          <option value="world">world logs</option>
        </select>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4 max-[1020px]:grid-cols-1">
        <aside className="h-[calc(100vh-190px)] min-h-[480px] overflow-auto rounded-xl border border-[#d5e4f4] bg-white p-3 shadow-[0_10px_20px_rgba(15,33,57,0.05)]">
          <FileTree nodes={tree} selectedPath={selectedPath} onSelectFile={setSelectedPath} />
        </aside>

        <section>
          <MonacoEditorPanel value={content} language={language} readOnly onChange={setContent} />
          {loading ? <p className="mt-2 text-xs text-[#6f819a]">加载中...</p> : null}
        </section>
      </div>
    </main>
  );
}
