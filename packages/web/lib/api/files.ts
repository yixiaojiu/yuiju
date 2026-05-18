export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

export type LogsService = "message" | "world";

type FileTreeResponse = {
  data?: {
    tree?: FileTreeNode[];
  };
};

type FileContentResponse = {
  data?: {
    content?: string;
    language?: string;
  };
};

export const fetchFileTree = async (scope: "logs" | "memory", service?: LogsService) => {
  const query = new URLSearchParams({ scope });
  if (service) {
    query.set("service", service);
  }

  const response = await fetch(`/api/nodejs/files/tree?${query.toString()}`);
  const payload = (await response.json()) as FileTreeResponse;
  return payload.data?.tree ?? [];
};

export const fetchFileContent = async (
  scope: "logs" | "memory",
  path: string,
  service?: LogsService,
) => {
  const query = new URLSearchParams({ scope, path });
  if (service) {
    query.set("service", service);
  }

  const response = await fetch(`/api/nodejs/files/content?${query.toString()}`);
  const payload = (await response.json()) as FileContentResponse;

  return {
    content: payload.data?.content ?? "",
    language: payload.data?.language ?? "plaintext",
  };
};

export const saveMemoryFile = async (path: string, content: string) => {
  await fetch("/api/nodejs/files/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "memory",
      path,
      content,
    }),
  });
};
