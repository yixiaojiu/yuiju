import { ProxyAgent } from "undici";
import { load_config } from "../config/load";

let proxyAgent: ProxyAgent | undefined;

/** 仅供显式开启 use_proxy 的请求使用；地址由配置校验保证，连接池按进程复用，不改变全局 fetch。 */
export async function fetchWithProxy(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const config = await load_config();
  proxyAgent ??= new ProxyAgent(config.app!.proxy_url!);
  const request = { ...init, dispatcher: proxyAgent };
  // Node 内置 fetch 与独立 undici 的 Dispatcher 声明版本不同，运行时支持同一调度接口。
  return await fetch(input, request as unknown as RequestInit);
}

/** 业务请求停止后关闭代理连接池；未使用代理的进程没有需要释放的连接。 */
export async function closeHttpProxy(): Promise<void> {
  await proxyAgent?.close();
  proxyAgent = undefined;
}
