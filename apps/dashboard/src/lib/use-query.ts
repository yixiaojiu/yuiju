"use client";

import { useEffect, useState } from "react";

/** 页面只读查询：切换条件时取消旧请求；轮询串行执行，不叠加慢请求。 */
export function useQuery<T>(url: string, intervalMs?: number) {
  const [result, setResult] = useState<{ url: string; data?: T; error?: string }>({ url });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error);
        }
        setResult({ url, data: body });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ url, error: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        if (intervalMs && !controller.signal.aborted) {
          timer = setTimeout(load, intervalMs);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, intervalMs]);
  return result.url === url ? result : { url };
}
