"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  type FileTreeNode,
  type LogsService,
  fetchFileContent,
  fetchFileTree,
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

const containsFilePath = (nodes: FileTreeNode[], targetPath: string): boolean => {
  for (const node of nodes) {
    if (node.type === "file" && node.path === targetPath) return true;
    if (containsFilePath(node.children ?? [], targetPath)) return true;
  }
  return false;
};

export default function LogsPage() {
  const [service, setService] = useState<LogsService>("message");
  const [selectedPath, setSelectedPath] = useState("");

  const {
    data: tree = [],
    isLoading: treeLoading,
    error: treeError,
  } = useSWR(["logs-tree", service], async () => fetchFileTree("logs", service));

  useEffect(() => {
    if (tree.length === 0) {
      setSelectedPath("");
      return;
    }

    const currentPathExists = selectedPath && containsFilePath(tree, selectedPath);
    if (currentPathExists) {
      return;
    }

    setSelectedPath(collectFirstFilePath(tree));
  }, [selectedPath, tree]);

  const {
    data: filePayload,
    isLoading: contentLoading,
    error: contentError,
  } = useSWR(
    selectedPath ? ["logs-content", service, selectedPath] : null,
    async () => fetchFileContent("logs", selectedPath, service),
  );

  const content = filePayload?.content ?? "";
  const language = filePayload?.language ?? "plaintext";
  const loading = treeLoading || contentLoading;
  const requestError = treeError || contentError;

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
          <MonacoEditorPanel value={content} language={language} readOnly onChange={() => {}} />
          {loading ? <LoadingIndicator /> : null}
          {requestError ? <p className="mt-2 text-xs text-[#d05d58]">加载失败，请重试。</p> : null}
        </section>
      </div>
    </main>
  );
}
