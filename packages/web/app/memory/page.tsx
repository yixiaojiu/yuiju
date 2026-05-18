"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type FileTreeNode,
  fetchFileContent,
  fetchFileTree,
  saveMemoryFile,
} from "@/lib/api/files";
import { LoadingIndicator } from "@/lib/components/loading-indicator";
import { FileTree } from "../file-browser/file-tree";
import { MonacoEditorPanel } from "../file-browser/monaco-editor-panel";

const collectFirstFilePath = (nodes: FileTreeNode[]): string => {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const nested = collectFirstFilePath(node.children ?? []);
    if (nested) return nested;
  }
  return "";
};

export default function MemoryPage() {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadTree = async () => {
      const nodes = await fetchFileTree("memory");
      setTree(nodes);
      setSelectedPath(collectFirstFilePath(nodes));
    };

    void loadTree();
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setContent("");
      setSavedContent("");
      return;
    }

    const loadContent = async () => {
      setLoading(true);
      try {
        const payload = await fetchFileContent("memory", selectedPath);
        setContent(payload.content);
        setSavedContent(payload.content);
        setLanguage(payload.language);
      } finally {
        setLoading(false);
      }
    };

    void loadContent();
  }, [selectedPath]);

  const dirty = useMemo(() => content !== savedContent, [content, savedContent]);

  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await saveMemoryFile(selectedPath, content);
      setSavedContent(content);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-8 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2f47]">长期记忆文件编辑</h1>
          <p className="mt-1 text-sm text-[#667791]">记忆页可编辑并保存到 memory 目录。</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving || !selectedPath}
          className="rounded-lg bg-[#2f7ee6] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#9abce9]"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4 max-[1020px]:grid-cols-1">
        <aside className="h-[calc(100vh-190px)] min-h-[480px] overflow-auto rounded-xl border border-[#d5e4f4] bg-white p-3 shadow-[0_10px_20px_rgba(15,33,57,0.05)]">
          <FileTree nodes={tree} selectedPath={selectedPath} onSelectFile={setSelectedPath} />
        </aside>

        <section>
          <MonacoEditorPanel
            value={content}
            language={language}
            readOnly={false}
            onChange={setContent}
          />
          {loading ? <LoadingIndicator /> : null}
        </section>
      </div>
    </main>
  );
}
