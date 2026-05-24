"use client";

import { ChevronRight, FileText, Folder } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { FileTreeNode } from "@/lib/api/files";
import { cn } from "@/lib/utils";

type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
};

const collectDirectoryPaths = (items: FileTreeNode[]) => {
  const dirs: string[] = [];
  for (const item of items) {
    if (item.type !== "directory") continue;
    dirs.push(item.path);
    dirs.push(...collectDirectoryPaths(item.children ?? []));
  }
  return dirs;
};

const findParentDirs = (
  items: FileTreeNode[],
  targetPath: string,
  lineage: string[] = [],
): string[] => {
  for (const item of items) {
    if (item.type === "file" && item.path === targetPath) {
      return lineage;
    }
    if (item.type === "directory") {
      const next = findParentDirs(item.children ?? [], targetPath, [...lineage, item.path]);
      if (next.length > 0) {
        return next;
      }
    }
  }
  return [];
};

export const FileTree = ({ nodes, selectedPath, onSelectFile }: FileTreeProps) => {
  const rootDirPaths = useMemo(() => {
    return nodes.filter((node) => node.type === "directory").map((node) => node.path);
  }, [nodes]);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(rootDirPaths));

  useEffect(() => {
    setExpandedDirs((prev) => {
      const validDirs = new Set(collectDirectoryPaths(nodes));
      const next = new Set<string>();

      for (const dir of prev) {
        if (validDirs.has(dir)) {
          next.add(dir);
        }
      }
      for (const dir of rootDirPaths) {
        next.add(dir);
      }
      for (const dir of findParentDirs(nodes, selectedPath)) {
        next.add(dir);
      }

      return next;
    });
  }, [nodes, rootDirPaths, selectedPath]);

  const toggleDirectory = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: FileTreeNode, depth: number): ReactNode => {
    const isDirectory = node.type === "directory";
    const isExpanded = isDirectory && expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => (isDirectory ? toggleDirectory(node.path) : onSelectFile(node.path))}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            isSelected ? "bg-[#dcecff] text-[#1e2f4a]" : "text-[#50617a] hover:bg-[#edf4fb]",
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {isDirectory ? (
            <>
              <ChevronRight
                className={cn(
                  "size-3.5 text-[#6c7e98] transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
              <Folder className="size-4 text-[#5077b8]" />
            </>
          ) : (
            <>
              <span className="inline-block size-3.5" />
              <FileText className="size-4 text-[#7b8ea9]" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>

        {isDirectory && isExpanded ? (
          <div className="relative ml-3 border-l border-[#e1ebf6] pl-1">
            {(node.children ?? []).map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return <div className="space-y-1">{nodes.map((node) => renderNode(node, 0))}</div>;
};
