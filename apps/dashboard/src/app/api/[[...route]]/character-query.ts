import { HTTPException } from "hono/http-exception";

/** 查询入口只接受配置中声明的角色，避免访问任意角色的存储目录。 */
export function getQueryCharacter(
  characterId: string | undefined,
  characters: { id: string; name: string }[],
) {
  const character = characters.find((entry) => entry.id === characterId);
  if (!character) {
    throw new HTTPException(400, { message: "请选择已配置的角色" });
  }
  return character;
}
