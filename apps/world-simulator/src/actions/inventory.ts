import type { ConditionView } from "@yuiju/shared/world/protocol";
import { z } from "zod";
import { itemsById } from "../content/items";
import type { WorldCharacterState } from "../state";

export const itemSelectionSchema = z
  .array(z.strictObject({ itemId: z.string().min(1), quantity: z.number().int().positive() }))
  .min(1)
  .refine(
    (selection) => new Set(selection.map((item) => item.itemId)).size === selection.length,
    "同一种物品只能出现一次，请合并数量",
  );
export type ItemSelection = z.infer<typeof itemSelectionSchema>;

/** 参数校验之后的库存条件；不裁剪数量、不跳过缺货项。 */
export function checkInventory(
  character: WorldCharacterState,
  selection: ItemSelection,
  category?: "food" | "ingredient",
): ConditionView[] {
  return selection.map(({ itemId, quantity }) => {
    const item = itemsById.get(itemId);
    const valid =
      item &&
      (category === undefined || item.categories.includes(category)) &&
      character.inventory[itemId] >= quantity;
    return {
      description: `背包中有 ${quantity} 份${itemId}${category === "food" ? "，且可直接食用" : category === "ingredient" ? "，且可用作食材" : ""}`,
      status: valid ? "met" : "unmet",
    };
  });
}

/** 调用方已检查库存；修改的是本次行动尚未提交的角色状态。 */
export function consumeItems(character: WorldCharacterState, selection: ItemSelection): void {
  for (const { itemId, quantity } of selection) {
    character.inventory[itemId] -= quantity;
    if (character.inventory[itemId] === 0) {
      delete character.inventory[itemId];
    }
  }
}
export function receiveItems(character: WorldCharacterState, selection: ItemSelection): void {
  for (const { itemId, quantity } of selection) {
    character.inventory[itemId] = (character.inventory[itemId] ?? 0) + quantity;
  }
}
