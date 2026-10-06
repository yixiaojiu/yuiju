import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LanguageModelUsage } from "ai";
import type { Reporter } from "vitest/node";

export type EvaluationCase = {
  id: string;
  title: string;
  /** 固定业务时间；请求耗时使用 performance.now，不受此时间影响。 */
  time: string;
};
export type TraceEntry = {
  id: number;
  parent?: number;
  elapsedMs: number;
  kind: "request" | "step" | "tool" | "effect" | "log";
  title: string;
  data: unknown;
};
export type EvaluationResult = EvaluationCase & {
  input: unknown;
  startedAt: string;
  durationMs: number;
  trace: TraceEntry[];
  /** 运行后阅读完整轨迹填写；执行器不根据工具调用或输出自动评分。 */
  assessment?: { conclusion: string; evidence: string };
  configuration?: unknown;
  error?: string;
};

/** 嵌套 Replyer 请求归在调用它的 reply 工具下面，不靠日志时间猜测归属。 */
export const traceScope = new AsyncLocalStorage<{
  result: EvaluationResult;
  startedAt: number;
  signal: AbortSignal;
  parent?: number;
}>();

export function snapshot(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/^(authorization|api[_-]?key|token|cookie|headers)$/i.test(key)) {
        return "[已隐藏]";
      }
      if (item instanceof Error) {
        return { name: item.name, message: item.message };
      }
      return item;
    }),
  );
}

export function record(kind: TraceEntry["kind"], title: string, data: unknown): number {
  const scope = traceScope.getStore()!;
  const id = scope.result.trace.length + 1;
  scope.result.trace.push({
    id,
    parent: scope.parent,
    elapsedMs: Math.round(performance.now() - scope.startedAt),
    kind,
    title,
    data: snapshot(data),
  });
  return id;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function details(title: string, value: unknown): string {
  return `<details><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre></details>`;
}

/** 主线展示消息正文；参数和存储对象保留 JSON，完整模型上下文另行折叠。 */
function renderTraceEntry(entry: TraceEntry): string {
  let content: string;
  if (entry.title === "QQ 发送文字（模拟确认）") {
    const message = entry.data as { senderName: string; content: string };
    content = `${message.senderName}：${message.content}`;
  } else if (entry.title.endsWith("批输入与 trigger")) {
    const input = entry.data as {
      messages: { senderName: string; content: string }[];
      trigger: { shouldRun: boolean; score: number };
    };
    content = `${input.messages.map((message) => `${message.senderName}：${message.content}`).join("\n")}\n→ ${input.trigger.shouldRun ? "进入 Planner" : "未触发 Planner"}（评分 ${input.trigger.score}）`;
  } else {
    content = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2);
  }
  return `<li><span class="muted">${(entry.elapsedMs / 1000).toFixed(1)}s · #${entry.id}${entry.parent ? ` ← #${entry.parent}` : ""}</span> <strong>${escapeHtml(entry.title)}</strong><pre>${escapeHtml(content)}</pre></li>`;
}

/** 汇总独立场景文件；即使某个测试失败，已经采集的请求和工具结果仍能阅读。 */
export function evaluationReporter(outputDir: string, revision: string): Reporter {
  return {
    async onTestRunEnd(modules, errors, reason) {
      const results: EvaluationResult[] = [];
      for (const name of (await readdir(outputDir))
        .filter((name) => name.endsWith(".case.json"))
        .sort()) {
        results.push(JSON.parse(await readFile(join(outputDir, name), "utf8")));
      }
      const runnerErrors = [
        ...errors.map((error) => error.message),
        ...modules.flatMap((module) => module.errors().map((error) => error.message)),
      ];
      const testResults = modules.flatMap((module) =>
        [...module.children.allTests()].map((test) => ({ name: test.name, result: test.result() })),
      );
      const completed = results.filter((result) => !result.error).length;
      const reviewed = results.filter((result) => result.assessment !== undefined).length;
      const sections = results
        .map((result) => {
          const tools = result.trace.filter((entry) => entry.kind === "tool");
          const requests = result.trace.filter((entry) => entry.kind === "request");
          const steps = result.trace.filter((entry) => entry.kind === "step");
          const usage = steps.map((step) => (step.data as { usage: LanguageModelUsage }).usage);
          const tokens =
            usage.length > 0 && usage.every((item) => typeof item.totalTokens === "number")
              ? `${usage.reduce((sum, item) => sum + item.totalTokens!, 0).toLocaleString()} tokens（已完成步骤）`
              : "token 用量未返回";
          return `<section id="${escapeHtml(result.id)}"><h2>${escapeHtml(result.title)} <span class="${result.error ? "fail" : "muted"}">${result.error ? "执行未完成" : "执行完成"} · ${result.assessment ? "已评价" : "待评价"}</span></h2>
<p class="muted">${(result.durationMs / 1000).toFixed(1)} 秒 · ${requests.length} 次模型 HTTP 请求 · ${tools.length} 次工具执行 · ${tokens}</p>
${result.error ? `<pre class="fail">执行错误：${escapeHtml(result.error)}</pre>` : ""}
<h3>轨迹评价</h3>${result.assessment ? `<p><strong>${escapeHtml(result.assessment.conclusion)}</strong></p><pre>${escapeHtml(result.assessment.evidence)}</pre>` : "<p>待评价：运行后结合输入、完整轨迹和实际结果判断，不以工具调用路径判定对错。执行完成不等于行为合理。</p>"}
<h3>输入与初始状态</h3>${details("展开场景数据（固定业务时间、事件、外部响应）", result.input)}
<h3>运行主线</h3><ol>${
            result.trace
              .filter((entry) => entry.kind === "tool" || entry.kind === "effect")
              .map(renderTraceEntry)
              .join("") || "<li>没有工具调用或外部操作。</li>"
          }</ol>
${result.configuration === undefined ? "<p>本次未取得配置快照。</p>" : details("本次模型与窗口配置（不含凭证）", result.configuration)}${details("模型每步输出与 token 用量", steps)}${details("完整请求、工具结果与日志（按发生顺序）", result.trace)}</section>`;
        })
        .join("\n");
      const summary = {
        revision,
        reason,
        completed,
        reviewed,
        total: results.length,
        runnerErrors,
        testResults,
        results,
      };
      await writeFile(join(outputDir, "results.json"), JSON.stringify(summary, null, 2));
      await writeFile(
        join(outputDir, "index.html"),
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>角色 Agent 测评</title><style>
body{font:15px/1.65 system-ui,sans-serif;background:#f5f6f8;color:#202631;margin:0}main{max-width:1080px;margin:auto;padding:32px 24px}header,section{background:white;border:1px solid #e2e5eb;border-radius:12px;padding:24px;margin-bottom:20px}h1,h2,h3{line-height:1.35}h2{font-size:21px}h3{font-size:16px;margin-top:24px}h2 span{font-size:13px;margin-left:12px}.muted{color:#697382}.pass{color:#187548}.fail{color:#b52f37}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f8;padding:12px;border-radius:6px;font:13px/1.6 ui-monospace,monospace}details{margin:10px 0}summary{cursor:pointer;color:#315b9a}li{margin:10px 0}a{color:#315b9a}nav a{display:block}ol{padding-left:24px}</style><main>
<header><h1>角色 Agent 测评</h1><p>共 ${results.length} 个场景：执行完成 ${completed} 个，执行未完成 ${results.length - completed} 个；已评价 ${reviewed} 个，待评价 ${results.length - reviewed} 个。运行情况与行为评价分别记录，不统计自动通过率。</p><p>真实模型、提示词与工具业务逻辑；世界响应、QQ 发送和存储由场景替代。无真实 QQ 发送，无业务数据库写入。跳过分段发送延迟；wait 只记录暂停意图，本轮不自动推进计时。</p><p class="muted">代码版本：${escapeHtml(revision)} · 每场景 90 秒 / 20 次模型 HTTP 请求上限 · 模型输出具有随机性</p>${details("运行器结果（仅表示执行情况，包含跳过或未生成报告的用例）", { reason, runnerErrors, testResults })}<nav>${results.map((result) => `<a href="#${escapeHtml(result.id)}">${escapeHtml(result.title)}</a>`).join("")}</nav></header>${sections}</main></html>`,
      );
      console.log(
        `\n测评报告：${join(outputDir, "index.html")}\n执行完成 ${completed}/${results.length}；已评价 ${reviewed}/${results.length}。执行状态不代表行为评价。`,
      );
    },
  };
}
