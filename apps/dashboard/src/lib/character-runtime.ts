import { load_config } from "@yuiju/shared/config/load";
import { HTTPException } from "hono/http-exception";

/** 仅在 Dashboard 服务端调用；浏览器不接触角色地址，所有接口固定在 /api 下。 */
export async function requestCharacterRuntime(
  characterId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const character = (await load_config()).characters![characterId];
  if (!character) {
    throw new HTTPException(400, { message: "请选择已配置的角色" });
  }
  if (!character.runtime) {
    throw new HTTPException(400, { message: `角色 ${characterId} 缺少 runtime.base_url 配置` });
  }
  const baseUrl = character.runtime.base_url.replace(/\/$/, "");
  try {
    return await fetch(`${baseUrl}/api${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new HTTPException(502, {
      message: "角色服务连接中断或请求超时，执行结果未确认，请重新查询或同步",
      cause: error,
    });
  }
}
