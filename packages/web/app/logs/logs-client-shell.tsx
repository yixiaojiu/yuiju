"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MonacoEditorPanel } from "@/components/monaco-readonly";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "logs" | "memory";
type LogService = "all" | "world" | "message";
type LogLevel = "" | "debug" | "info" | "warn" | "error";

type LogItem = {
  line: string;
};

type LogQueryResult = {
  items: LogItem[];
  total: number;
};

type LogSearchResponse = {
  code: number;
  message: string;
  data: LogQueryResult;
};

type MemoryFilePayload = {
  personId: string;
  exists: boolean;
  content: string;
};

type MemoryFileResponse = {
  code: number;
  message: string;
  data: MemoryFilePayload;
};

const fetchLogPayload = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as LogSearchResponse;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "日志加载失败");
  }
  return payload.data;
};

const buildEditorText = (items: LogItem[]) => {
  if (!items.length) {
    return "没有匹配的日志记录。";
  }
  return items.map((item) => item.line).join("\n");
};

export function LogsClientShell() {
  const [mode, setMode] = useState<Mode>("logs");
  const [service, setService] = useState<LogService>("all");
  const [level, setLevel] = useState<LogLevel>("");
  const [keywordInput, setKeywordInput] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");

  const [personIdInput, setPersonIdInput] = useState("");
  const [activePersonId, setActivePersonId] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryStatusText, setMemoryStatusText] = useState("输入 personId 后点击“加载文件”。");
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  const apiPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("service", service);
    if (level) {
      params.set("level", level);
    }
    if (submittedKeyword.trim()) {
      params.set("keyword", submittedKeyword.trim());
    }
    if (startDate) {
      params.set("startDate", startDate);
    }
    if (endDate) {
      params.set("endDate", endDate);
    }
    params.set("limit", "500");
    return `/api/nodejs/logs/search?${params.toString()}`;
  }, [service, level, submittedKeyword, startDate, endDate]);

  const { data, error, isLoading, isValidating } = useSWR(apiPath, fetchLogPayload, {
    keepPreviousData: true,
  });
  const items = data?.items ?? [];
  const isBusy = isLoading || isValidating;
  const editorText = useMemo(() => buildEditorText(items), [items]);

  const loadMemoryFile = async () => {
    const personId = personIdInput.trim();
    if (!personId) {
      setMemoryStatusText("请先输入 personId。");
      return;
    }

    setIsLoadingMemory(true);
    setMemoryStatusText("正在加载...");
    try {
      const response = await fetch(
        `/api/nodejs/memory/file?personId=${encodeURIComponent(personId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as MemoryFileResponse;
      if (!response.ok || payload.code !== 0) {
        throw new Error(payload.message || "加载失败");
      }

      setActivePersonId(payload.data.personId);
      setMemoryContent(payload.data.content);
      setMemoryStatusText(payload.data.exists ? "已加载现有人物记忆文件。" : "文件不存在，已生成模板。");
    } catch (loadError) {
      setMemoryStatusText(loadError instanceof Error ? `加载失败：${loadError.message}` : "加载失败");
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const saveMemoryFile = async () => {
    if (!activePersonId) {
      setMemoryStatusText("请先加载一个 personId 文件。");
      return;
    }

    setIsSavingMemory(true);
    setMemoryStatusText("正在保存...");
    try {
      const response = await fetch("/api/nodejs/memory/file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personId: activePersonId,
          content: memoryContent,
        }),
      });
      const payload = (await response.json()) as { code: number; message: string };
      if (!response.ok || payload.code !== 0) {
        throw new Error(payload.message || "保存失败");
      }

      setMemoryStatusText("保存成功。");
    } catch (saveError) {
      setMemoryStatusText(saveError instanceof Error ? `保存失败：${saveError.message}` : "保存失败");
    } finally {
      setIsSavingMemory(false);
    }
  };

  return (
    <div className="grid grid-cols-[320px_1fr] max-[1020px]:grid-cols-1 gap-[14px] items-start mt-4.5">
      <Card>
        <CardHeader>
          <CardTitle>查看模式</CardTitle>
          <CardDescription>日志查看与记忆编辑共用同一页。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <p className="text-xs text-[#6b7480]">模式</p>
            <Select value={mode} onValueChange={(value) => setMode(value as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="logs">日志查看</SelectItem>
                <SelectItem value="memory">记忆编辑</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "logs" ? (
            <>
              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">服务</p>
                <Select value={service} onValueChange={(value) => setService(value as LogService)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="world">world</SelectItem>
                    <SelectItem value="message">message</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">级别</p>
                <Select
                  value={level || "all"}
                  onValueChange={(value) => setLevel(value === "all" ? "" : (value as LogLevel))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="debug">debug</SelectItem>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warn">warn</SelectItem>
                    <SelectItem value="error">error</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">开始日期</p>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">结束日期</p>
                <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>

              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">关键字（回车生效）</p>
                <Input
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setSubmittedKeyword(keywordInput);
                    }
                  }}
                  placeholder="输入后按回车"
                />
              </div>

              <p className="text-xs text-[#6b7480]">
                {error instanceof Error
                  ? `加载失败：${error.message}`
                  : isBusy
                    ? "日志加载中..."
                    : `共 ${data?.total ?? 0} 条`}
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <p className="text-xs text-[#6b7480]">personId</p>
                <Input
                  value={personIdInput}
                  onChange={(event) => setPersonIdInput(event.target.value)}
                  placeholder="例如 123456789"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={loadMemoryFile} disabled={isLoadingMemory}>
                  {isLoadingMemory ? "加载中..." : "加载文件"}
                </Button>
                <Button size="sm" onClick={saveMemoryFile} disabled={isSavingMemory || !activePersonId}>
                  {isSavingMemory ? "保存中..." : "保存文件"}
                </Button>
              </div>

              <p className="text-xs text-[#6b7480]">{memoryStatusText}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{mode === "logs" ? "日志查看器" : "记忆文件编辑器"}</CardTitle>
          <CardDescription>
            {mode === "logs"
              ? "Monaco 只读模式，展示日志原始行。"
              : "Monaco 可编辑模式，保存前会校验 JSON 结构。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {mode === "logs" ? (
            <MonacoEditorPanel value={editorText} readOnly />
          ) : (
            <MonacoEditorPanel value={memoryContent} readOnly={false} onChange={setMemoryContent} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
