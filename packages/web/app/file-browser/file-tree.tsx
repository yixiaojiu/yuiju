"use client";

import type { ReactNode } from "react";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
};

const renderNode = (
  node: FileTreeNode,
  selectedPath: string,
  onSelectFile: (path: string) => void,
  depth: number,
): ReactNode => {
  if (node.type === "directory") {
    return (
      <details key={node.path} open className="group">
        <summary className="cursor-pointer list-none rounded-md px-2 py-1.5 text-sm text-[#4a5a70] hover:bg-[#edf4fb]">
          {"  ".repeat(depth)}[D] {node.name}
        </summary>
        <div className="mt-1 space-y-0.5">
          {(node.children ?? []).map((child) =>
            renderNode(child, selectedPath, onSelectFile, depth + 1),
          )}
        </div>
      </details>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <button
      key={node.path}
      type="button"
      onClick={() => onSelectFile(node.path)}
      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        isSelected ? "bg-[#dcecff] text-[#1e2f4a]" : "text-[#50617a] hover:bg-[#edf4fb]"
      }`}
    >
      {"  ".repeat(depth)}[F] {node.name}
    </button>
  );
};

export const FileTree = ({ nodes, selectedPath, onSelectFile }: FileTreeProps) => {
  return (
    <div className="space-y-1">
      {nodes.map((node) => renderNode(node, selectedPath, onSelectFile, 0))}
    </div>
  );
};
