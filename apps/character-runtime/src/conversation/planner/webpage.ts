import { truncateToolOutput } from "@yuiju/shared/llm/tool-output";
import { logger } from "@yuiju/shared/logger/logger";

/** 免 Key 读取公开网页，正文由 Jina 限制为 8,000 tokens；保留加载提醒，分类返回失败原因，不重试。 */
export async function readWebpage(url: string, abortSignal?: AbortSignal): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(30_000);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain",
        "X-Max-Tokens": "10000",
        // 目标站的错误页面不能作为成功读取的正文交给 Planner。
        "X-Assert-Status-Code": "200",
      },
      signal,
    });
    const content = await response.text();
    if (!response.ok) {
      const type =
        response.status === 429
          ? "Jina 请求限流"
          : response.status === 422
            ? "目标网页抓取或解析失败"
            : "Jina 请求失败";
      logger.warn("网页读取失败", { url, type, status: response.status, reason: content });
      return [
        "网页读取失败",
        `URL：${url}`,
        `类型：${type}`,
        `Jina HTTP：${response.status}`,
        `原因：${truncateToolOutput(content)}`,
      ].join("\n");
    }
    return content;
  } catch (error) {
    const type = abortSignal?.aborted
      ? "请求取消"
      : timeoutSignal.aborted
        ? "请求超时（30 秒）"
        : "网络请求失败";
    let reason = error instanceof Error ? error.message : String(error);
    // Node fetch 的连接、DNS 和 TLS 失败原因放在 cause 中；多地址连接失败时为 AggregateError。
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof AggregateError) {
      reason += `；${cause.errors
        .map((item) => (item instanceof Error ? item.message : String(item)))
        .join("；")}`;
    } else if (cause instanceof Error) {
      reason += `；${cause.message}`;
    }
    logger.warn("网页读取失败", { url, type, error });
    return [
      "网页读取失败",
      `URL：${url}`,
      `类型：${type}`,
      `原因：${truncateToolOutput(reason)}`,
    ].join("\n");
  }
}
