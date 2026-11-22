import type { Vec3 } from "./character-design";
import type { PixelPose } from "./pixel-character";

/**
 * 像素角色的动作清单。每个动作是一个按「动作开始后经过的秒数」算出姿势的函数：
 * loop 为 true 的动作一直循环；否则播放 duration 秒后回到之前的循环动作。
 * 坐标都在上半身空间里：脚底为原点，+Z 朝前，胸口约在 0.6，头部中心约在 1.04。
 * 角色不画手臂，手是两个小球，直接放在这里给出的位置。
 * pose 的 rest 是当前这套衣服站着时画面右边那只手的位置（见各套衣服的 restHand），另一只手镜像。
 */
export type PixelAction = {
  label: string;
  loop: boolean;
  duration: number;
  pose: (t: number, rest: Vec3) => PixelPose;
};

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

/** 把画面右边那只手的位置镜像到画面左边。 */
function mirror(hand: Vec3): Vec3 {
  return [-hand[0], hand[1], hand[2]];
}

/** 站着不动时的姿势：双手放在待机位置，隔一会儿呼气沉 1 像素。各动作在它的基础上改。 */
function stand(t: number, rest: Vec3): PixelPose {
  return {
    rise: Math.sin(t * 2) < -0.6 ? -1 : 0,
    headDrop: 0,
    lean: 0,
    hands: [mirror(rest), rest],
    step: null,
    seated: false,
    tailFlow: 0,
    eyes: null,
    mouth: null,
    prop: null,
    headShift: 0,
    turn: 0,
    jump: 0,
    emote: null,
  };
}

/**
 * 上饮品和收杯子共用的三个手的位置：端在身前、放到台面、推到顾客那一侧。
 * 台面高约 0.57（光影喫茶店吧台台面 0.40 米换算到角色尺寸），放到台面时手球的底贴着台面。
 * 这两个动作只管手，手里的饮品由场景摆放。
 */
const holdAt: Vec3 = [0.14, 0.634, 0.32],
  counterAt: Vec3 = [0.1, 0.62, 0.42],
  pushedAt: Vec3 = [0.08, 0.62, 0.55];
/** 吃东西时手送到的位置：嘴巴正下方、脸的前面，不挡住眼睛。 */
const mouthAt: Vec3 = [0.05, 0.7, 0.34];
export const pixelActions = {
  idle: { label: "待机", loop: true, duration: 0, pose: stand },
  sit: {
    label: "坐下",
    loop: true,
    duration: 0,
    pose: (t, rest) => ({ ...stand(t, rest), seated: true }),
  },
  walk: {
    label: "走路",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 小碎步：每秒约 2.4 步、步幅小，手停在待机位置不摆。
      const step = t * 7.5;
      return {
        ...stand(t, rest),
        // 两脚交错经过身体下方那一刻抬高 1 像素。
        rise: Math.abs(Math.sin(step)) < 0.5 ? 1 : 0,
        // 上身微微前倾：0.11 弧度在 30° 俯视下正好让头的中心下移整 1 像素，脸部像素不错位。
        lean: 0.11,
        step,
      };
    },
  },
  run: {
    label: "跑步",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 仍是小碎步，只是更快（每秒约 3.8 步）；手停在待机位置。
      const step = t * 12;
      return {
        ...stand(t, rest),
        rise: Math.abs(Math.sin(step)) < 0.5 ? 1 : 0,
        // 身体更前倾：0.205 弧度在 30° 俯视下正好让头的中心下移整 2 像素。
        lean: 0.205,
        step,
        // 马尾往后扬，随着落脚一颠一颠。
        tailFlow: 1,
      };
    },
  },
  wave: {
    label: "挥手",
    loop: false,
    duration: 1.6,
    pose: (t, rest) => {
      const raised = ramp(t, 0, 0.25) * (1 - ramp(t, 1.35, 1.6));
      const sway = Math.sin(t * 14) * 0.07;
      return {
        ...stand(t, rest),
        // 手举到脸旁边、马尾前面才看得出在挥手。
        hands: [mirror(rest), mix(rest, [0.42 + sway, 0.95, 0.2], raised)],
        eyes: "happy",
        mouth: "smile",
      };
    },
  },
  bow: {
    label: "鞠躬",
    loop: false,
    duration: 1.6,
    pose: (t, rest) => {
      const lean = 0.4 * ramp(t, 0, 0.3) * (1 - ramp(t, 1.1, 1.5));
      return { ...stand(t, rest), rise: 0, lean, eyes: lean > 0.1 ? "closed" : null };
    },
  },
  nod: {
    label: "点头",
    loop: false,
    duration: 0.8,
    pose: (t, rest) => {
      // 点两下：头沉 1 像素并闭眼，像素游戏里不转头，用位移表现点头。
      const down = (t > 0.1 && t < 0.28) || (t > 0.42 && t < 0.6);
      return {
        ...stand(t, rest),
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
    pose: (t, rest) => {
      // 每 2.4 秒停顿 0.5 秒，说话时嘴按两个频率叠加开合，节奏不呆板。
      const speaking = t % 2.4 < 1.9 && Math.sin(t * 13) + Math.sin(t * 7.3) > 0.3;
      const gesture = 0.5 + 0.5 * Math.sin(t * 2.4);
      return {
        ...stand(t, rest),
        hands: [mirror(rest), mix(rest, [0.22, 0.5, 0.3], gesture)],
        mouth: speaking ? "open" : "line",
      };
    },
  },
  think: {
    label: "思考",
    loop: true,
    duration: 0,
    pose: (t, rest) => ({
      ...stand(t, rest),
      // 一只手托着下巴。
      hands: [
        [-0.06, 0.4, 0.22],
        [0.08, 0.68, 0.3],
      ],
      emote: "dots",
    }),
  },
  wipe: {
    label: "擦杯子",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      const cup: Vec3 = [-0.02, 0.53, 0.32];
      return {
        ...stand(t, rest),
        hands: [
          [-0.06, 0.5, 0.3],
          [0.06 + 0.04 * Math.cos(t * 7), 0.53 + 0.022 * Math.sin(t * 7), 0.32],
        ],
        eyes: "shy",
        prop: { kind: "cup", at: cup, tilt: 0 },
      };
    },
  },
  brew: {
    label: "制作饮品",
    loop: true,
    duration: 0,
    pose: (t, rest) => ({
      ...stand(t, rest),
      // 上身微微前倾，双手伸到身前一上一下交替按压，像在操作咖啡机。
      lean: 0.1,
      hands: [
        [-0.12, 0.51 + 0.036 * Math.sin(t * 6), 0.42],
        [0.12, 0.51 - 0.036 * Math.sin(t * 6), 0.42],
      ],
      eyes: "shy",
    }),
  },
  serve: {
    label: "上饮品",
    loop: false,
    duration: 2.6,
    pose: (t, rest) => {
      // 端到身前 → 放到台面 → 推到顾客那一侧 → 收手。
      const hand =
        t < 0.35
          ? mix(rest, holdAt, ramp(t, 0, 0.35))
          : t < 0.8
            ? mix(holdAt, counterAt, ramp(t, 0.35, 0.8))
            : t < 1.5
              ? mix(counterAt, pushedAt, ramp(t, 0.8, 1.5))
              : mix(pushedAt, rest, ramp(t, 1.5, 2));
      return {
        ...stand(t, rest),
        lean: 0.12 * ramp(t, 0.8, 1.2) * (1 - ramp(t, 1.5, 1.9)),
        hands: [mirror(rest), hand],
        eyes: t > 1.8 ? "happy" : null,
        mouth: t > 1.8 ? "smile" : null,
      };
    },
  },
  collect: {
    label: "收杯子",
    loop: false,
    duration: 2.2,
    pose: (t, rest) => {
      // 伸手到推出去的那个位置 → 停一下拿起 → 端回身前 → 收手。
      const hand =
        t < 0.5
          ? mix(rest, pushedAt, ramp(t, 0, 0.5))
          : t < 0.7
            ? pushedAt
            : t < 1.3
              ? mix(pushedAt, holdAt, ramp(t, 0.7, 1.3))
              : mix(holdAt, rest, ramp(t, 1.3, 1.7));
      return {
        ...stand(t, rest),
        lean: 0.12 * ramp(t, 0.2, 0.5) * (1 - ramp(t, 0.7, 1.1)),
        hands: [mirror(rest), hand],
      };
    },
  },
  phone: {
    label: "玩手机",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 双手在胸前捧着手机，头低 1 像素看屏幕；每 4 秒眯眼笑一下，像看到好玩的东西。
      const laughing = t % 4 > 3.2;
      return {
        ...stand(t, rest),
        headDrop: 1,
        hands: [
          [-0.06, 0.5, 0.3],
          [0.06, 0.5, 0.3],
        ],
        eyes: laughing ? "happy" : "shy",
        mouth: laughing ? "smile" : null,
        prop: { kind: "phone", at: [0, 0.54, 0.33], tilt: 0 },
      };
    },
  },
  eat: {
    label: "吃东西",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 一口约 2.4 秒：右手把面包送到嘴下方，咬一口，放回身前，然后嚼。
      const k = t % 2.4;
      const up = ramp(k, 0, 0.4) * (1 - ramp(k, 0.7, 1.1));
      const hand = mix(rest, mouthAt, up);
      const chewing = k > 1.1 && Math.sin(k * 16) > 0;
      return {
        ...stand(t, rest),
        hands: [mirror(rest), hand],
        eyes: k > 1.1 ? "happy" : null,
        mouth: up > 0.9 || chewing ? "open" : "line",
        prop: { kind: "bun", at: [hand[0] - 0.03, hand[1] + 0.04, hand[2] + 0.03], tilt: 0 },
      };
    },
  },
  drink: {
    label: "喝饮料",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 双手捧杯在胸前，每 3.5 秒举到嘴边喝一口，喝的时候闭眼。
      const k = t % 3.5;
      const up = ramp(k, 2.1, 2.5) * (1 - ramp(k, 3.1, 3.5));
      const y = 0.5 + 0.16 * up;
      return {
        ...stand(t, rest),
        hands: [
          [-0.07, y, 0.3],
          [0.07, y, 0.3],
        ],
        eyes: up > 0.8 ? "closed" : null,
        prop: { kind: "cup", at: [0, y - 0.02, 0.33], tilt: 0 },
      };
    },
  },
  doze: {
    label: "打瞌睡",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 一次约 3 秒：闭着眼，头慢慢往下点 1 像素、2 像素，然后猛地抬回来、睁一下眼。
      const k = t % 3;
      const jerk = k > 2.7;
      return {
        ...stand(t, rest),
        rise: 0,
        headDrop: jerk ? 0 : k > 2 ? 2 : k > 1 ? 1 : 0,
        eyes: jerk ? "sleepy" : "closed",
        emote: "sleep",
      };
    },
  },
  stretch: {
    label: "伸懒腰",
    loop: false,
    duration: 2.2,
    pose: (t, rest) => {
      // 双手举过头顶、身体往上 1 像素，闭眼打个哈欠，停一下再放下。
      const up = ramp(t, 0, 0.6) * (1 - ramp(t, 1.6, 2.1));
      // 举到帽顶上面，否则手会藏进贝雷帽里。
      const high: Vec3 = [0.17, 1.62, 0];
      return {
        ...stand(t, rest),
        rise: up > 0.5 ? 1 : 0,
        hands: [mix(mirror(rest), mirror(high), up), mix(rest, high, up)],
        eyes: up > 0.5 ? "closed" : null,
        mouth: up > 0.5 ? "open" : null,
      };
    },
  },
  hop: {
    label: "开心蹦一下",
    loop: false,
    duration: 1,
    pose: (t, rest) => {
      // 先蹲 1 像素，跳起 3 像素（连腿一起离地），落地再蹲一下；在空中时双手往上一抬。
      const jump = t < 0.15 ? 0 : t < 0.25 ? 1 : t < 0.55 ? 3 : t < 0.65 ? 1 : 0;
      const crouch = t < 0.15 || (t > 0.65 && t < 0.8);
      const air = jump > 0 ? 1 : 0;
      const raised: Vec3 = [0.16, 0.62, 0.26];
      return {
        ...stand(t, rest),
        rise: crouch ? -1 : 0,
        jump,
        hands: [mix(mirror(rest), mirror(raised), air), mix(rest, raised, air)],
        eyes: "happy",
        mouth: "laugh",
      };
    },
  },
  startle: {
    label: "惊吓",
    loop: false,
    duration: 1.2,
    pose: (t, rest) => {
      // 吓得往上一弹 1 像素，双手缩到胸前，头顶冒「!」。
      const chest: Vec3 = [0.05, 0.6, 0.3];
      return {
        ...stand(t, rest),
        jump: t > 0.05 && t < 0.3 ? 1 : 0,
        hands: [mirror(chest), chest],
        eyes: "surprised",
        mouth: "open",
        emote: "exclaim",
      };
    },
  },
  sweep: {
    label: "扫地",
    loop: true,
    duration: 0,
    pose: (t, rest) => {
      // 双手一上一下握着扫帚，扫帚头在脚边左右扫，每 1.2 秒来回一次；上身前倾 1 像素，看着地面。
      const tilt = 0.35 * Math.sin((t * Math.PI * 2) / 1.2);
      // 握在身前、裙子外面，扫帚往前斜着伸出去，扫帚头落在裙摆前面才看得见。
      const grip: Vec3 = [0, 0.46, 0.4];
      return {
        ...stand(t, rest),
        lean: 0.11,
        hands: [
          [grip[0] - 0.06 * Math.sin(tilt), grip[1] + 0.06, grip[2] - 0.02],
          [grip[0] + 0.06 * Math.sin(tilt), grip[1] - 0.06, grip[2]],
        ],
        eyes: "shy",
        prop: { kind: "broom", at: grip, tilt },
      };
    },
  },
  note: {
    label: "记菜单",
    loop: true,
    duration: 0,
    pose: (t, rest) => ({
      ...stand(t, rest),
      // 左手托着小本子，右手在本子上小幅移动，像在写字；头低 1 像素看着本子。
      headDrop: 1,
      // 本子在胸前偏左，左手托在它左下角，右手在它右边写，不把本子挡住。
      hands: [
        [-0.1, 0.5, 0.32],
        [0.06 + 0.015 * Math.sin(t * 9), 0.58 + 0.01 * Math.sin(t * 4.3), 0.37],
      ],
      eyes: "shy",
      prop: { kind: "notepad", at: [-0.03, 0.57, 0.36], tilt: 0 },
    }),
  },
  tilt: {
    label: "歪头",
    loop: false,
    duration: 1.4,
    pose: (t, rest) => ({
      ...stand(t, rest),
      // 头往一侧平移 1 像素，头顶冒「?」，停一下再回来。
      headShift: t > 0.15 && t < 1.15 ? 1 : 0,
      emote: "question",
    }),
  },
  glance: {
    label: "转身看",
    loop: false,
    duration: 1.6,
    pose: (t, rest) => ({
      ...stand(t, rest),
      // 整个人转向一侧看一眼，再转回原来的朝向。
      turn: t > 0.2 && t < 1.3 ? Math.PI / 2 : 0,
    }),
  },
} satisfies Record<string, PixelAction>;

export type PixelActionName = keyof typeof pixelActions;
