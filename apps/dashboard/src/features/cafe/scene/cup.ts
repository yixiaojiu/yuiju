import { Group, LatheGeometry, Mesh, MeshStandardMaterial, Vector2 } from "three";

const CUP_HEIGHT = 0.09;
const LIQUID_TOP = 0.082;

/**
 * 顾客面前的一杯饮品：碟子、杯子和里面的咖啡。原点在碟子底部中心。
 * 用 setRemaining 设置剩余量，咖啡的液面随之下降。
 */
export function createCup() {
  const cup = new Group();
  const ceramic = new MeshStandardMaterial({ color: 0xf4ead8, roughness: 0.4 });
  const saucer = new Mesh(
    new LatheGeometry(
      [
        new Vector2(0, 0),
        new Vector2(0.04, 0),
        new Vector2(0.078, 0.012),
        new Vector2(0.078, 0.017),
        new Vector2(0, 0.007),
      ],
      24,
    ),
    ceramic,
  );
  cup.add(saucer);
  const body = new Mesh(
    new LatheGeometry(
      [
        new Vector2(0, 0.009),
        new Vector2(0.038, 0.009),
        new Vector2(0.045, 0.02),
        new Vector2(0.047, CUP_HEIGHT),
        new Vector2(0.042, CUP_HEIGHT),
        new Vector2(0.04, 0.024),
        new Vector2(0, 0.022),
      ],
      24,
    ),
    ceramic,
  );
  cup.add(body);
  // 咖啡是一个薄圆片，按剩余量在杯底和杯口之间移动。
  const liquid = new Mesh(
    new LatheGeometry(
      [new Vector2(0, 0), new Vector2(0.041, 0), new Vector2(0.041, 0.003), new Vector2(0, 0.003)],
      24,
    ),
    new MeshStandardMaterial({ color: 0x3a2216, roughness: 0.3 }),
  );
  cup.add(liquid);

  function setRemaining(remaining: number) {
    liquid.position.y = 0.024 + (LIQUID_TOP - 0.024) * remaining;
    liquid.visible = remaining > 0;
  }
  setRemaining(1);
  return { object: cup, setRemaining };
}
