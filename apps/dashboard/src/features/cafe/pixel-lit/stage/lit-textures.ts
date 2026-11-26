import { DataTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from "three";

type Rgba = readonly [number, number, number, number];

function hexToRgba(hex: string, alpha = 255): Rgba {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function scaleRgba(base: Rgba, factor: number): Rgba {
  return [
    clampByte(base[0] * factor),
    clampByte(base[1] * factor),
    clampByte(base[2] * factor),
    base[3],
  ];
}

function hash2d(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function createPixelTexture(
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgba,
  /** 铺满表面的贴图要首尾相接地重复，图案贴图只贴一次。 */
  tiled = false,
) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const offset = ((height - 1 - y) * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  if (tiled) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

function stampTexture(rows: readonly string[], palette: Record<string, string>) {
  const width = rows[0].length;
  const height = rows.length;
  const lookup = Object.fromEntries(
    Object.entries(palette).map(([key, hex]) => [key, hexToRgba(hex)]),
  );
  return createPixelTexture(width, height, (x, y) => {
    const cell = rows[y][x];
    return lookup[cell] ?? [0, 0, 0, 0];
  });
}

/**
 * 场景表面的像素贴图，尺寸按米来定，和俯视角无关。
 * 铺满表面的贴图（地板、土間、木条、台面、墙面）在材质里按世界坐标铺，一个纹素是 2 个屏幕像素宽（0.056 米）见方，
 * 不管贴在多大的物体上、朝哪个方向、从哪个视角看，纹理的疏密都一样。
 * 图案贴图（地毯、黑板、挂画）按物体自身的 UV 贴满一次，物体按纹素数换算成米来定尺寸。
 */
export function createLitTextures() {
  const created: DataTexture[] = [];
  const track = (t: DataTexture) => {
    created.push(t);
    return t;
  };

  // 木地板：每块板 5 纹素宽（0.28 米），沿进深方向 24 纹素长，相邻木板的接缝错开。
  const planks = (hex: string) => {
    const base = hexToRgba(hex);
    return track(
      createPixelTexture(
        20,
        24,
        (x, y) => {
          const plank = Math.floor(x / 5);
          const lx = x % 5;
          const seamY = (y + plank * 9) % 24;
          if (lx === 0 || seamY === 0) {
            return scaleRgba(base, 0.62);
          }
          const tone = [1.0, 0.93, 1.05, 0.96][plank % 4];
          const grain = lx === 2 && seamY % 7 > 3 ? 0.94 : 1.0;
          return scaleRgba(base, tone * grain);
        },
        true,
      ),
    );
  };
  const woodFloorColor = planks("#8a5938");
  // 吧台内的地板比客区深一档，地面一变就分出了店员区。
  const barFloorColor = planks("#6e4630");

  // 门口土間的石砖：每块 6 纹素见方，砖缝深色，每块砖的明暗略有不同。
  const stoneBase = hexToRgba("#8f8173");
  const domaColor = track(
    createPixelTexture(
      12,
      12,
      (x, y) => {
        if (x % 6 === 0 || y % 6 === 0) {
          return scaleRgba(stoneBase, 0.66);
        }
        return scaleRgba(stoneBase, 0.94 + hash2d(Math.floor(x / 6), Math.floor(y / 6)) * 0.12);
      },
      true,
    ),
  );

  // 蜂蜜色台面：每 4 纹素一道浅木纹。
  const honeyBase = hexToRgba("#cf9352");
  const honeyWoodColor = track(
    createPixelTexture(
      8,
      8,
      (x, y) => {
        if (y % 4 === 0) {
          return scaleRgba(honeyBase, 0.86);
        }
        return scaleRgba(honeyBase, (x + y) % 5 === 0 ? 1.04 : 0.99);
      },
      true,
    ),
  );

  // 竖条木护墙板和吧台立面：每条木板 3 纹素宽，一道暗缝一道亮边。
  const slatBase = hexToRgba("#5c3824");
  const woodSlatsColor = track(
    createPixelTexture(
      6,
      6,
      (x) => {
        const m = x % 3;
        if (m === 0) {
          return scaleRgba(slatBase, 0.6);
        }
        if (m === 1) {
          return scaleRgba(slatBase, 1.08);
        }
        return slatBase;
      },
      true,
    ),
  );

  // 奶油米色墙面
  const wallBase = hexToRgba("#ead4ae");
  const creamWallColor = track(
    createPixelTexture(16, 16, (x, y) => scaleRgba(wallBase, 0.985 + hash2d(x, y) * 0.03), true),
  );

  // 中间小圆桌下的织纹地毯：44 × 30 纹素，按 0.056 米一个纹素是 2.46 × 1.68 米。
  const rugColor = track(
    createPixelTexture(44, 30, (x, y) => {
      const bx = Math.min(x, 43 - x);
      const by = Math.min(y, 29 - y);
      const edge = Math.min(bx, by);
      if (edge === 0) {
        return hexToRgba("#422820");
      }
      if (edge <= 2) {
        return hexToRgba("#96453b");
      }
      if (edge === 3) {
        return (x + y) % 2 === 0 ? hexToRgba("#fce4b3") : hexToRgba("#c48b55");
      }
      const diamond = (x % 6 === 0 && y % 4 === 0) || (x % 6 === 3 && y % 4 === 2);
      return diamond ? hexToRgba("#b86446") : hexToRgba("#96453b");
    }),
  );

  // 长椅角的长条地毯：抹茶绿，20 × 52 纹素，铺满两张小桌底下。
  const benchRugColor = track(
    createPixelTexture(20, 52, (x, y) => {
      const edge = Math.min(x, 19 - x, y, 51 - y);
      if (edge === 0) {
        return hexToRgba("#3f4a2e");
      }
      if (edge === 2) {
        return hexToRgba("#efe0be");
      }
      return (x + y) % 8 === 0 ? hexToRgba("#94ab70") : hexToRgba("#7f9861");
    }),
  );

  // 黑板菜单：32 × 18 纹素，一个纹素 1 个屏幕像素宽。
  const chalkboardColor = track(
    stampTexture(
      [
        "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
        "OggggggggggggggggggggggggggggggO",
        "Ogg.yyyyyy....yyyyy..........ggO",
        "OggggggggggggggggggggggggggggggO",
        "Ogg.wwwwww.ww.....ccccc......ggO",
        "Oggggggggggggg...cc...cc.cc..ggO",
        "Ogg.wwww.wwww....cc...cc..c..ggO",
        "Oggggggggggggg...cc...cc.cc..ggO",
        "Ogg.wwwwwww.w.....ccccc......ggO",
        "Oggggggggggggg...wwwwwww.....ggO",
        "Ogg.www.wwwww................ggO",
        "OggggggggggggggggggggggggggggggO",
        "Ogg.aaaa..wwwwwww...aaa......ggO",
        "OggggggggggggggggggggggggggggggO",
        "Ogg.wwwwww.www....wwwww......ggO",
        "OggggggggggggggggggggggggggggggO",
        "OggggggggggggggggggggggggggggggO",
        "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO",
      ],
      {
        O: "#422820",
        g: "#28322c",
        ".": "#28322c",
        w: "#fcfaf5",
        y: "#fce4b3",
        c: "#f4dac2",
        a: "#9cb87d",
      },
    ),
  );

  // 小挂画：18 × 14 纹素，一个纹素 1 个屏幕像素宽。
  const paintingWarm = track(
    stampTexture(
      [
        "OOOOOOOOOOOOOOOOOO",
        "OMMMMMMMMMMMMMMMMO",
        "OMssssssssssssssMO",
        "OMsssoooooooosssMO",
        "OMssooyyyyyyoossMO",
        "OMsssoooooooosssMO",
        "OMttttttwwttttttMO",
        "OMtttttwwwwtttttMO",
        "OMtttttwwwwtttttMO",
        "OMttttttwwttttttMO",
        "OMddddddddddddddMO",
        "OMddddddddddddddMO",
        "OMMMMMMMMMMMMMMMMO",
        "OOOOOOOOOOOOOOOOOO",
      ],
      {
        O: "#2c1b22",
        M: "#5e3a27",
        s: "#dfb074",
        o: "#fce4b3",
        y: "#fcfaf5",
        t: "#9e6843",
        w: "#fcfaf5",
        d: "#422820",
      },
    ),
  );

  return {
    woodFloorColor,
    barFloorColor,
    domaColor,
    honeyWoodColor,
    woodSlatsColor,
    creamWallColor,
    rugColor,
    benchRugColor,
    chalkboardColor,
    paintingWarm,
    dispose() {
      for (const t of created) {
        t.dispose();
      }
    },
  };
}

export type LitTextures = ReturnType<typeof createLitTextures>;
