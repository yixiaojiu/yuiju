import type { PixelPose, Vec3 } from "./pixel-character";

/**
 * 像素角色的动作清单。每个动作是一个按「动作开始后经过的秒数」算出姿势的函数：
 * loop 为 true 的动作一直循环；否则播放 duration 秒后回到之前的循环动作。
 * 坐标都在上半身空间里：脚底为原点，+Z 朝前，肩膀在 (±0.18, 0.6, 0)，双手交握时在 (±0.045, 0.43, 0.2)。
 */
export type PixelAction = {
  label: string;
  loop: boolean;
  duration: number;
  pose: (t: number) => PixelPose;
};

const restHands: [Vec3, Vec3] = [
  [-0.045, 0.43, 0.2],
  [0.045, 0.43, 0.2],
];

/** 在 [start, end] 秒之间从 0 平滑过渡到 1。 */
function ramp(t: number, start: number, end: number) {
  const k = Math.min(1, Math.max(0, (t - start) / (end - start)));
  return k * k * (3 - 2 * k);
}

function mix(from: Vec3, to: Vec3, k: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ];
}

/** 站着不动时的姿势：双手交握，隔一会儿呼气沉 1 像素。各动作在它的基础上改。 */
function stand(t: number): PixelPose {
  return {
    rise: Math.sin(t * 2) < -0.6 ? -1 : 0,
    headDrop: 0,
    lean: 0,
    hands: restHands,
    step: null,
    seated: false,
    eyes: null,
    mouth: null,
    cup: null,
    emote: null,
  };
}

/**
 * 上饮品和收杯子共用的三个位置：端在身前、放到台面、推到顾客那一侧。
 * 台面高 0.5（咖啡馆吧台的高度），杯子底贴着台面。
 */
const holdAt: Vec3 = [0.12, 0.58, 0.3],
  counterAt: Vec3 = [0.08, 0.53, 0.38],
  pushedAt: Vec3 = [0.06, 0.53, 0.5];
/** 杯子相对手的位置：在手的前上方，看起来是被手握着或推着。 */
function cupAt(hand: Vec3): Vec3 {
  return [hand[0], hand[1] + 0.02, hand[2] + 0.09];
}

/** 上饮品结束时杯子留下的位置（身体空间）。场景按这个位置把杯子摆到台面上。 */
export const servedCupPosition = cupAt(pushedAt);

export const pixelActions = {
  idle: { label: "待机", loop: true, duration: 0, pose: stand },
  sit: {
    label: "坐下",
    loop: true,
    duration: 0,
    pose: (t) => ({ ...stand(t), seated: true }),
  },
  walk: {
    label: "走路",
    loop: true,
    duration: 0,
    pose: (t) => {
      const step = t * 7.2;
      // 两脚交错经过身体下方那一刻抬高 1 像素。
      return { ...stand(t), rise: Math.abs(Math.sin(step)) < 0.5 ? 1 : 0, step };
    },
  },
  wave: {
    label: "挥手",
    loop: false,
    duration: 1.6,
    pose: (t) => {
      const raised = ramp(t, 0, 0.25) * (1 - ramp(t, 1.35, 1.6));
      const sway = Math.sin(t * 14) * 0.07;
      return {
        ...stand(t),
        // 胳膊短，手要举到脸旁边、马尾前面才看得出在挥手。
        hands: [restHands[0], mix(restHands[1], [0.5 + sway, 1.0, 0.22], raised)],
        eyes: "happy",
        mouth: "smile",
      };
    },
  },
  bow: {
    label: "鞠躬",
    loop: false,
    duration: 1.6,
    pose: (t) => {
      const lean = 0.4 * ramp(t, 0, 0.3) * (1 - ramp(t, 1.1, 1.5));
      return { ...stand(t), rise: 0, lean, eyes: lean > 0.1 ? "closed" : null };
    },
  },
  nod: {
    label: "点头",
    loop: false,
    duration: 0.8,
    pose: (t) => {
      // 点两下：头沉 1 像素并闭眼，像素游戏里不转头，用位移表现点头。
      const down = (t > 0.1 && t < 0.28) || (t > 0.42 && t < 0.6);
      return {
        ...stand(t),
        rise: 0,
        headDrop: down ? 1 : 0,
        eyes: down ? "closed" : null,
        mouth: "smile",
      };
    },
  },
  talk: {
    label: "说话",
    loop: true,
    duration: 0,
    pose: (t) => {
      // 每 2.4 秒停顿 0.5 秒，说话时嘴按两个频率叠加开合，节奏不呆板。
      const speaking = t % 2.4 < 1.9 && Math.sin(t * 13) + Math.sin(t * 7.3) > 0.3;
      const gesture = 0.5 + 0.5 * Math.sin(t * 2.4);
      return {
        ...stand(t),
        hands: [restHands[0], mix(restHands[1], [0.16, 0.52, 0.27], gesture)],
        mouth: speaking ? "open" : "line",
      };
    },
  },
  think: {
    label: "思考",
    loop: true,
    duration: 0,
    pose: (t) => ({
      ...stand(t),
      hands: [
        [-0.06, 0.47, 0.2],
        [0.08, 0.68, 0.26],
      ],
      emote: "dots",
    }),
  },
  wipe: {
    label: "擦杯子",
    loop: true,
    duration: 0,
    pose: (t) => {
      const cup: Vec3 = [-0.02, 0.53, 0.3];
      return {
        ...stand(t),
        hands: [
          [-0.05, 0.5, 0.28],
          [0.05 + 0.04 * Math.cos(t * 7), 0.53 + 0.03 * Math.sin(t * 7), 0.3],
        ],
        eyes: "shy",
        cup,
      };
    },
  },
  brew: {
    label: "制作饮品",
    loop: true,
    duration: 0,
    pose: (t) => ({
      ...stand(t),
      // 上身微微前倾，双手伸到身前一上一下交替按压，像在操作咖啡机。
      lean: 0.1,
      hands: [
        [-0.1, 0.52 + 0.05 * Math.sin(t * 6), 0.4],
        [0.1, 0.52 - 0.05 * Math.sin(t * 6), 0.4],
      ],
      eyes: "shy",
    }),
  },
  serve: {
    label: "上饮品",
    loop: false,
    duration: 2.6,
    pose: (t) => {
      // 端到身前 → 放到台面 → 推到顾客那一侧 → 收手，杯子留在推到的位置。
      const hand =
        t < 0.35
          ? mix(restHands[1], holdAt, ramp(t, 0, 0.35))
          : t < 0.8
            ? mix(holdAt, counterAt, ramp(t, 0.35, 0.8))
            : t < 1.5
              ? mix(counterAt, pushedAt, ramp(t, 0.8, 1.5))
              : mix(pushedAt, restHands[1], ramp(t, 1.5, 2));
      return {
        ...stand(t),
        lean: 0.12 * ramp(t, 0.8, 1.2) * (1 - ramp(t, 1.5, 1.9)),
        hands: [restHands[0], hand],
        cup: t < 1.5 ? cupAt(hand) : servedCupPosition,
        eyes: t > 1.8 ? "happy" : null,
        mouth: t > 1.8 ? "smile" : null,
      };
    },
  },
  collect: {
    label: "收杯子",
    loop: false,
    duration: 2.2,
    pose: (t) => {
      // 伸手到推出去的那个位置 → 停一下拿起 → 端回身前 → 收起来，杯子消失。
      const hand =
        t < 0.5
          ? mix(restHands[1], pushedAt, ramp(t, 0, 0.5))
          : t < 0.7
            ? pushedAt
            : t < 1.3
              ? mix(pushedAt, holdAt, ramp(t, 0.7, 1.3))
              : mix(holdAt, restHands[1], ramp(t, 1.3, 1.7));
      return {
        ...stand(t),
        lean: 0.12 * ramp(t, 0.2, 0.5) * (1 - ramp(t, 0.7, 1.1)),
        hands: [restHands[0], hand],
        cup: t < 0.7 ? servedCupPosition : t < 1.5 ? cupAt(hand) : null,
      };
    },
  },
} satisfies Record<string, PixelAction>;

export type PixelActionName = keyof typeof pixelActions;
