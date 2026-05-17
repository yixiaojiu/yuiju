import {
  ActionId,
  type ActionMetadata,
  allTrue,
  type ChoiceOption,
  MajorScene,
  planManager,
  SHOP_PRODUCTS,
  type ShopProduct,
} from "@yuiju/utils";
import { chooseShopProductAgent } from "@/llm/agent";
import { logger } from "@/utils/logger";
import { buildFoodMetadata } from "../utils/food-utils";

const SHOP_MIN_PRICE = Math.min(...SHOP_PRODUCTS.map((p) => p.price));

function isAtShop(major: MajorScene) {
  return major === MajorScene.Shop;
}

function formatProductDescription(product: ShopProduct) {
  const description: string[] = [];
  if (product.stamina) {
    description.push(`[体力+${product.stamina}]`);
  }

  if (product.satiety) {
    description.push(`[饱腹+${product.satiety}]`);
  }

  if (product.mood) {
    description.push(`[心情+${product.mood}]`);
  }

  return `${product.description}${description.join("")}`;
}

export const shopAction: ActionMetadata[] = [
  {
    action: ActionId.Buy_Item_At_Shop,
    description: "在小町商店购买零食，一次只能购买一件商品。[耗时10分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([
        () => isAtShop(context.characterState.location.major),
        () => context.characterState.money >= SHOP_MIN_PRICE,
      ]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Buy_Item_At_Shop);

      let remainingMoney = context.characterState.money;

      const productList: ChoiceOption[] = SHOP_PRODUCTS.map((product) => {
        return {
          value: product.name,
          description: formatProductDescription(product),
        };
      });

      const selectedProduct = await chooseShopProductAgent(
        productList,
        context,
        [],
        await planManager.getState(),
      );
      if (!selectedProduct) {
        logger.error("[Buy_Item_At_Shop] 没有选择商品");
        return { executionResult: "购买失败，没有选择商品。" };
      }

      const product = SHOP_PRODUCTS.find((p) => p.name === selectedProduct.value);
      if (!product) {
        logger.error(`[Buy_Item_At_Shop] 未找到商品: ${selectedProduct.value}`);
        return { executionResult: "购买失败，未找到商品。" };
      }

      const desiredQuantity = selectedProduct.quantity ?? 1;
      const maxAffordable = Math.floor(remainingMoney / product.price);
      if (maxAffordable <= 0) {
        logger.info(
          `[Buy_Item_At_Shop] 余额不足，跳过购买: ${product.name}（单价${product.price}元，余额${remainingMoney}元）`,
        );
        return { executionResult: "购买失败，余额不足。" };
      }

      const quantity = Math.min(Math.max(1, desiredQuantity), maxAffordable);
      if (quantity !== desiredQuantity) {
        logger.info(
          `[Buy_Item_At_Shop] 购买数量已裁剪: ${product.name} ${desiredQuantity} -> ${quantity}（余额${remainingMoney}元）`,
        );
      }

      const cost = product.price * quantity;
      await context.characterState.changeMoney(-cost);
      remainingMoney -= cost;

      logger.info(
        `[Buy_Item_At_Shop] 购买成功: ${product.name} x${quantity}，花费${cost}元，剩余${remainingMoney}元`,
      );

      return {
        executionResult: `买了${product.name}${quantity}个，花费${cost}元，等待取货`,
        startContext: {
          productName: product.name,
          description: product.description,
          quantity,
          stamina: product.stamina,
          satiety: product.satiety,
          mood: product.mood,
          fallbackSatiety: Math.round(product.price / 5),
        },
      };
    },
    async completionEvent(context, runningAction) {
      const purchaseContext = runningAction.startContext as {
        productName: string;
        description: string;
        quantity: number;
        stamina?: number;
        satiety?: number;
        mood?: number;
        fallbackSatiety: number;
      };

      await context.characterState.addItem(
        {
          name: purchaseContext.productName,
          description: purchaseContext.description,
          category: "food",
          metadata: buildFoodMetadata({
            stamina: purchaseContext.stamina,
            satiety: purchaseContext.satiety,
            mood: purchaseContext.mood,
            fallbackSatiety: purchaseContext.fallbackSatiety,
          }),
        },
        purchaseContext.quantity,
      );

      return {
        completionContext: {
          purchasedItem: {
            name: purchaseContext.productName,
            quantity: purchaseContext.quantity,
          },
        },
        eventDescription: `拿到了${purchaseContext.productName}${purchaseContext.quantity}个`,
      };
    },
    durationMin: 10,
  },
  {
    action: ActionId.Go_Home_From_Shop,
    description: "从小町商店回家。[体力-5][饱腹-3][耗时20分钟]",
    precondition(context) {
      return isAtShop(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_Home_From_Shop);
      await context.characterState.setLocation({ major: MajorScene.Home });
      await context.characterState.changeStamina(-5);
      await context.characterState.changeSatiety(-3);
    },
    durationMin: 20,
  },
  {
    action: ActionId.Go_To_School_From_Shop,
    description: "从小町商店前往星见丘高校。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return isAtShop(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_School_From_Shop);
      await context.characterState.setLocation({ major: MajorScene.School });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
  {
    action: ActionId.Go_To_Coast_From_Shop,
    description: "从小町商店前往月汐海岸。[体力-7][饱腹-5][耗时30分钟]",
    precondition(context) {
      return isAtShop(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Coast_From_Shop);
      await context.characterState.setLocation({ major: MajorScene.Coast });
      await context.characterState.changeStamina(-7);
      await context.characterState.changeSatiety(-5);
    },
    durationMin: 30,
  },
];
