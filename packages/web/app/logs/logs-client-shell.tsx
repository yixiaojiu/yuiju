"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonacoReadonly } from "@/components/monaco-readonly";

type LogService = "all" | "world" | "message";
type LogLevel = "" | "debug" | "info" | "warn" | "error";

type LogItem = {
  tsNs: string;
  service: string;
  level: string;
  time: string;
  line: string;
  message: string;
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
  const [service, setService] = useState<LogService>("all");
  const [level, setLevel] = useState<LogLevel>("");
  const [keywordInput, setKeywordInput] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");

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

  return (
    <div className="grid grid-cols-[320px_1fr] max-[1020px]:grid-cols-1 gap-[14px] items-start mt-4.5">
      <Card>
        <CardHeader>
          <CardTitle>日志筛选</CardTitle>
          <CardDescription>筛选后在右侧 Monaco 只读查看。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
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
            <Select value={level || "all"} onValueChange={(value) => setLevel(value === "all" ? "" : (value as LogLevel))}>
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
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日志查看器</CardTitle>
          <CardDescription>Monaco 只读模式，展示日志原始行。</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <MonacoReadonly value={editorText} />
        </CardContent>
      </Card>
    </div>
  );
}
