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
  options: { repeatX?: number; repeatY?: number; srgb?: boolean } = {},
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
  texture.colorSpace = options.srgb === false ? "" : SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  if (options.repeatX !== undefined || options.repeatY !== undefined) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
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
 * 全局严格对齐屏幕像素密度的建筑表面像素贴图（ELEVATION = 30°，地面 Z 轴投影比为 0.5，
 * 所有 repeat 数按实际米尺寸换算，确保地面木纹、墙板、地毯、黑板上的 1 纹素 = 屏幕上的 1 正方形像素）。
 */
export function createLitTextures() {
  const created: DataTexture[] = [];
  const track = (t: DataTexture) => {
    created.push(t);
    return t;
  };

  // 1. 地面暖木地板（11.2m × 7.2m 投影为 280 × 90 屏幕像素；贴图 32×18，repeat 8.75 × 5 => 严格 1:1 像素！）
  const woodBase = hexToRgba("#8a5938");
  const woodFloorColor = track(
    createPixelTexture(
      32,
      18,
      (x, y) => {
        const plank = Math.floor(x / 8);
        const lx = x % 8;
        const seamY = (y + plank * 7) % 18;
        if (lx === 0 || seamY === 0) {
          return scaleRgba(woodBase, 0.55);
        }
        const tone = [1.0, 0.93, 1.05, 0.96][plank % 4];
        const grain = lx === 3 || lx === 5 ? 0.94 : 1.0;
        const shimmer = 0.97 + hash2d(plank, Math.floor(seamY / 3)) * 0.05;
        return scaleRgba(woodBase, tone * grain * shimmer);
      },
      { repeatX: 14, repeatY: 8 },
    ),
  );
  const woodFloorRoughness = track(
    createPixelTexture(
      32,
      18,
      (x, y) => {
        const plank = Math.floor(x / 8);
        const lx = x % 8;
        const seamY = (y + plank * 7) % 18;
        const v = lx === 0 || seamY === 0 ? 245 : [116, 132, 108, 124][plank % 4];
        return [v, v, v, 255];
      },
      { repeatX: 14, repeatY: 8, srgb: false },
    ),
  );

  // 2. 蜂蜜木吧台台面（像素木纹 + 半哑光粗糙度）
  const honeyBase = hexToRgba("#cf9352");
  const honeyWoodColor = track(
    createPixelTexture(
      16,
      12,
      (x, y) => {
        if (y % 4 === 0) {
          return scaleRgba(honeyBase, 0.84);
        }
        return scaleRgba(honeyBase, (x + y) % 5 === 0 ? 1.05 : 0.98);
      },
      { repeatX: 6, repeatY: 2 },
    ),
  );
  const honeyWoodRoughness = track(
    createPixelTexture(
      16,
      12,
      (_x, y) => {
        const v = y % 4 === 0 ? 160 : 94;
        return [v, v, v, 255];
      },
      { repeatX: 6, repeatY: 2, srgb: false },
    ),
  );

  // 3. 竖条木护墙板与吧台立面（严格 4 像素一格木条）
  const slatBase = hexToRgba("#5c3824");
  const woodSlatsColor = track(
    createPixelTexture(
      16,
      16,
      (x) => {
        const m = x % 4;
        if (m === 0) {
          return scaleRgba(slatBase, 0.52);
        }
        if (m === 1) {
          return scaleRgba(slatBase, 1.1);
        }
        return slatBase;
      },
      { repeatX: 28, repeatY: 2.4 },
    ),
  );

  // 4. 奶油米色墙面
  const wallBase = hexToRgba("#ead4ae");
  const creamWallColor = track(
    createPixelTexture(16, 16, (x, y) => scaleRgba(wallBase, 0.985 + hash2d(x, y) * 0.03), {
      repeatX: 28,
      repeatY: 4,
    }),
  );

  // 5. 吧台前织纹地毯（120 × 14 像素对应 4.8m × 1.12m 地面，严格 1:1 像素！）
  const rugColor = track(
    createPixelTexture(96, 14, (x, y) => {
      const bx = Math.min(x, 95 - x);
      const by = Math.min(y, 13 - y);
      if (bx === 0 || by === 0) {
        return hexToRgba("#422820");
      }
      if (bx <= 2 || by === 1) {
        return hexToRgba("#96453b");
      }
      if (bx <= 4 || by === 2) {
        return (x + y) % 2 === 0 ? hexToRgba("#fce4b3") : hexToRgba("#c48b55");
      }
      const diamond = (x % 6 === 0 && y % 3 === 0) || (x % 6 === 3 && y % 3 === 1);
      return diamond ? hexToRgba("#b86446") : hexToRgba("#96453b");
    }),
  );

  // 6. 黑板菜单（32 × 18 像素）
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

  // 7. 像素小挂画（18 × 14 像素）
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

  // 8. 置物架层板上的真像素器物条带（陶杯、茶筒、豆罐、彩书、小绿植，杜绝任何光滑圆柱！）
  const shelfRowItems = track(
    stampTexture(
      [
        "......OO.........OO.......OOOO............OO.............",
        ".....OqqO.......ORRO.....OMMMMO..........OllO............",
        "....OqwwqO.....ORRRRO....OqqqqO..OO.OO..OlGGlO....OO.....",
        ".OO.OqMMqO.OO..ORRRRO....OqMMqO.OTRORcO.OlGGlO...OaaO....",
        "OwwOOqMMqOOaaO.ORRRRO....OqMMqO.OTRORcO..OTTO...OaaaaO...",
        "OwwqOqMMqOaaaaOORRRRO....OqMMqO.OTRORcO..OTTO...OaaaaO...",
        "OwwOOqMMqOOaaO.ORRRRO....OqMMqO.OTRORcO..OTTO...OaaaaO...",
        ".OO..OOOO..OO...OOOO......OOOO...OOOOO...OOOO....OOOO....",
      ],
      {
        O: "#2c1b22",
        q: "#bee2f7",
        w: "#fcfaf5",
        M: "#5e3a27",
        R: "#96453b",
        a: "#9cb87d",
        T: "#b86446",
        c: "#fce4b3",
        l: "#79a35b",
        G: "#547d44",
      },
    ),
  );

  // 9. 和纸格栅纹理
  const shojiPaperColor = track(
    createPixelTexture(
      16,
      16,
      (x, y) => scaleRgba(hexToRgba("#f5eedc"), hash2d(x, y) > 0.8 ? 0.95 : 1.0),
      { repeatX: 2, repeatY: 2 },
    ),
  );

  return {
    woodFloorColor,
    woodFloorRoughness,
    honeyWoodColor,
    honeyWoodRoughness,
    woodSlatsColor,
    creamWallColor,
    rugColor,
    chalkboardColor,
    paintingWarm,
    shelfRowItems,
    shojiPaperColor,
    dispose() {
      for (const t of created) {
        t.dispose();
      }
    },
  };
}

export type LitTextures = ReturnType<typeof createLitTextures>;
