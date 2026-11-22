"use client";

import { useEffect, useRef, useState } from "react";
import {
  DepthTexture,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { type CharacterDesign, defaultCharacterDesign, type OutfitName } from "./character-design";
import { CharacterEditor, type DesignChange } from "./character-editor";
import { createModelView, type ModelView, type ModelViewMode } from "./model-view";
import { type PixelActionName, pixelActions } from "./pixel-actions";
import {
  createPixelCamera,
  createPixelCharacter,
  ELEVATION,
  type EmoteName,
  type ExpressionName,
  emotes,
  expressions,
  INNER_SHADE,
  OUTLINE_SHADE,
  PIXEL,
} from "./pixel-character";

const width = 64,
  height = 64;
const actionNames = Object.keys(pixelActions) as PixelActionName[];
/** 游戏里只有四个朝向，角色也只保证这四个角度渲染正常。 */
const views = [
  { label: "正面", angle: 0 },
  { label: "朝右", angle: 90 },
  { label: "背面", angle: 180 },
  { label: "朝左", angle: 270 },
];
/**
 * 编辑中的造型存在浏览器本地，刷新页面不丢。草稿记下它基于的默认造型，
 * 代码里的默认造型改过（比如草稿已经写回）之后，旧草稿不再载入。
 */
const DRAFT_KEY = "cafe.pixel-character.draft";
const defaultDesignJson = JSON.stringify(defaultCharacterDesign);
type Draft = { base: string; design: CharacterDesign };
const modelViewModes: [ModelViewMode, string][] = [
  ["free", "自由视角"],
  ["pixel", "同机位"],
];
/** 64×64 的格子叠在同机位画面上，每一格就是左边的一个像素。 */
const pixelGridStyle = {
  backgroundImage:
    "linear-gradient(to right, rgba(61,42,54,.28) 1px, transparent 1px), linear-gradient(to bottom, rgba(61,42,54,.28) 1px, transparent 1px)",
  backgroundSize: `calc(100% / ${width}) calc(100% / ${height})`,
};
const selectedButton = "bg-[#51453f] text-[#fff9ee]";
const quietButton = "text-[#645a4e] hover:bg-[#e9e1d4]";

/**
 * 像素画面的后处理：场景先按像素网格渲染到离屏贴图，再画到屏幕上，同时加上自选色描边（和光影场景的立牌一致）。
 * shadowAt 不为 null 时，在它投影到画面上的位置画一个椭圆影子。
 */
function createInk(
  camera: OrthographicCamera,
  width: number,
  height: number,
  shadowAt: Vector3 | null,
) {
  const target = new WebGLRenderTarget(width, height, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(width, height),
  });
  const ground = (shadowAt ?? new Vector3()).clone().project(camera);
  const material = new ShaderMaterial({
    uniforms: {
      source: { value: target.texture },
      depth: { value: target.depthTexture },
      texel: { value: new Vector2(1 / width, 1 / height) },
      shade: { value: OUTLINE_SHADE },
      innerShade: { value: INNER_SHADE },
      // 前后两个部件相距超过 0.1 个世界单位时，在靠后的那一侧画内描边。
      depthGap: { value: 0.1 / (camera.far - camera.near) },
      shadowCenter: { value: new Vector2((ground.x + 1) / 2, (ground.y + 1) / 2) },
      shadowRadius: { value: new Vector2(9 / width, 3.5 / height) },
    },
    defines: shadowAt ? { SHADOW: 1 } : {},
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D source; uniform sampler2D depth; uniform vec2 texel; uniform vec3 shade; uniform vec3 innerShade;
      uniform float depthGap; uniform vec2 shadowCenter; uniform vec2 shadowRadius;
      varying vec2 vUv;
      // 沿一个方向判断要不要画内描边：近的一侧比自己近出 depthGap 以上才算两个部件前后相叠。
      // 同一个斜面上（比如压扁的帽顶、30° 俯视时几乎平行于视线），另一侧会远出差不多的量，
      // 减掉它就不会误画线。另一侧是透明背景时不画：这个像素挨着外轮廓，
      // 多半是曲面转到侧面的边缘，深度变化最陡，分不出是不是两个部件。
      bool crease(vec2 uv,vec2 offset,float d){
        float a=texture2D(depth,uv+offset).r,b=texture2D(depth,uv-offset).r;
        if(texture2D(source,a>b?uv+offset:uv-offset).a<.5)return false;
        return d-min(a,b)-max(max(a,b)-d,0.)>depthGap;
      }
      // 记下四邻里最靠前（深度最小）的不透明像素，外描边取它的颜色压暗。
      void closer(vec2 uv,inout vec4 picked,inout float pickedDepth){
        vec4 c=texture2D(source,uv); float d=texture2D(depth,uv).r;
        if(c.a>.5&&d<pickedDepth){picked=c;pickedDepth=d;}
      }
      void main(){
        vec4 c=texture2D(source,vUv);
        vec2 dx=vec2(texel.x,0.),dy=vec2(0.,texel.y);
        if(c.a<.5){
          vec4 picked=vec4(0.); float pickedDepth=2.;
          closer(vUv+dx,picked,pickedDepth); closer(vUv-dx,picked,pickedDepth);
          closer(vUv+dy,picked,pickedDepth); closer(vUv-dy,picked,pickedDepth);
          if(picked.a>.5){
            c=vec4(picked.rgb*shade,1.);
          }else{
            c=vec4(0.);
            #ifdef SHADOW
            vec2 offset=(vUv-shadowCenter)/shadowRadius;
            c=vec4(vec3(.15,.18,.14),dot(offset,offset)<1.? .18 : 0.);
            #endif
          }
        }else{
          float d=texture2D(depth,vUv).r;
          if(crease(vUv,dx,d)||crease(vUv,dy,d))c.rgb*=innerShade;
        }
        gl_FragColor=c;
        #include <colorspace_fragment>
      }`,
  });
  const screen = new Scene(),
    quad = new PlaneGeometry(2, 2);
  const surface = new Mesh(quad, material);
  surface.frustumCulled = false;
  screen.add(surface);
  const screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  return {
    render(renderer: WebGLRenderer, scene: Scene) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, screenCamera);
    },
    dispose() {
      quad.dispose();
      material.dispose();
      target.dispose();
    },
  };
}

/**
 * 洛丽塔的配色对比：主色比头发深一档，和脸、头发的明暗拉得开；点缀色（蝴蝶结和丝带）鲜亮，
 * 并且避开奶白、浅粉这类接近肤色的颜色，不和手混在一起。
 * 只用在预览页，挑中的配色套用到草稿后再写回造型数据。
 */
const lolitaPalettes = [
  { label: "可可 + 水蓝", dress: "#6b4a3e", accent: "#8cc8ea" },
  { label: "雾蓝 + 莓红", dress: "#5f7fb0", accent: "#d0505c" },
  { label: "藏青 + 红", dress: "#3f4a78", accent: "#e0505a" },
  { label: "酒红 + 金", dress: "#8e3a48", accent: "#f2c45a" },
  { label: "墨绿 + 金", dress: "#3f6656", accent: "#f2c45a" },
  { label: "葡萄紫 + 水蓝", dress: "#5e4a86", accent: "#8cc8ea" },
  { label: "玫瑰 + 藏青", dress: "#b05a6e", accent: "#3f4a78" },
  { label: "深灰黑 + 莓红", dress: "#3a3540", accent: "#d0505c" },
];
type LolitaPalette = (typeof lolitaPalettes)[number];
/** 配色对比按 4 列 2 行排，每格 64×64，和上面的单人画面取景一致。 */
const PALETTE_COLUMNS = 4,
  PALETTE_ROWS = 2;

/**
 * 并排渲染 8 个穿洛丽塔的角色，每个一组配色，造型（发型、脸等）用当前草稿。
 * 同一台相机拍整张画布：左右按 64 像素一格错开；第二行放在更靠近镜头 64 像素的地方，
 * 30° 俯视下正好在画面上低 64 像素。
 */
function PaletteComparison({
  design,
  angle,
  onPick,
}: {
  design: CharacterDesign;
  angle: number;
  onPick: (palette: LolitaPalette) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<{ scene: Scene; camera: OrthographicCamera } | null>(null);
  const models = useRef<ReturnType<typeof createPixelCharacter>[]>([]);
  const angleRef = useRef(angle);
  useEffect(() => {
    angleRef.current = angle;
  }, [angle]);
  const stripWidth = width * PALETTE_COLUMNS,
    stripHeight = height * PALETTE_ROWS;
  const rowDepth = (height * PIXEL) / Math.sin(ELEVATION);

  useEffect(() => {
    const container = mount.current!;
    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    renderer.setSize(stripWidth, stripHeight, false);
    renderer.setClearColor(0, 0);
    const canvas = renderer.domElement;
    canvas.style.imageRendering = "pixelated";
    canvas.style.width = canvas.style.height = "100%";
    frame.current!.prepend(canvas);
    const observer = new ResizeObserver(() => {
      const scale = Math.max(1, Math.floor(container.clientWidth / stripWidth));
      frame.current!.style.width = stripWidth * scale + "px";
      frame.current!.style.height = stripHeight * scale + "px";
    });
    observer.observe(container);

    const scene = new Scene();
    // 画面中心对准两行中间，每格的取景和单人画面一样（中心比头部低 10 像素）。
    const camera = createPixelCamera(stripWidth, stripHeight, { x: 0, z: rowDepth / 2, up: -10 });
    stage.current = { scene, camera };
    const ink = createInk(camera, stripWidth, stripHeight, null);
    let previous = performance.now(),
      time = 0;
    renderer.setAnimationLoop((now) => {
      time += Math.min(0.06, (now - previous) / 1000);
      previous = now;
      for (const model of models.current) {
        model.root.rotation.y = (angleRef.current * Math.PI) / 180;
        model.animate(time);
      }
      ink.render(renderer, scene);
    });
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      stage.current = null;
      ink.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [stripWidth, stripHeight, rowDepth]);

  useEffect(() => {
    const { scene, camera } = stage.current!;
    const built = lolitaPalettes.map((palette, index) => {
      const model = createPixelCharacter(
        camera,
        {
          ...design,
          outfits: {
            ...design.outfits,
            lolita: {
              ...design.outfits.lolita,
              colors: {
                ...design.outfits.lolita.colors,
                dress: palette.dress,
                accent: palette.accent,
              },
            },
          },
        },
        "lolita",
      );
      const column = index % PALETTE_COLUMNS,
        row = Math.floor(index / PALETTE_COLUMNS);
      model.root.position.set(
        (column - (PALETTE_COLUMNS - 1) / 2) * width * PIXEL,
        0,
        row * rowDepth,
      );
      scene.add(model.root);
      return model;
    });
    models.current = built;
    return () => {
      for (const model of built) {
        scene.remove(model.root);
        model.dispose();
      }
      models.current = [];
    };
  }, [design, rowDepth]);

  const current = design.outfits.lolita.colors;
  return (
    <div ref={mount} className="grid gap-2 border-t border-[#e4dccf] px-4 py-4 text-sm">
      <span className="text-xs text-[#786c60]">洛丽塔配色对比（点一下套用到草稿）</span>
      <div ref={frame} className="relative bg-[#cbd7c3]">
        <div className="absolute inset-0 grid grid-cols-4 grid-rows-2">
          {lolitaPalettes.map((palette) => {
            const picked = palette.dress === current.dress && palette.accent === current.accent;
            return (
              <button
                key={palette.label}
                type="button"
                aria-pressed={picked}
                className={`flex items-end justify-center pb-1 text-xs ${picked ? "ring-2 ring-[#51453f] ring-inset" : "hover:bg-white/20"}`}
                onClick={() => onPick(palette)}
              >
                <span className="rounded bg-white/70 px-1.5 text-[#51453f]">{palette.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PixelCharacterPreview() {
  const mount = useRef<HTMLDivElement>(null);
  const modelColumn = useRef<HTMLDivElement>(null);
  const modelFrame = useRef<HTMLDivElement>(null);
  const modelView = useRef<ModelView | null>(null);
  const [modelMode, setModelMode] = useState<ModelViewMode>("free");
  const [wireframe, setWireframe] = useState(false);
  const [pixelGrid, setPixelGrid] = useState(true);
  const character = useRef<ReturnType<typeof createPixelCharacter> | null>(null);
  const stage = useRef<{ scene: Scene; camera: OrthographicCamera } | null>(null);
  const [design, setDesign] = useState(defaultCharacterDesign);
  const [angle, setAngle] = useState(0);
  const [looping, setLooping] = useState<PixelActionName>("idle");
  const [expression, setExpression] = useState<ExpressionName>("normal");
  const [outfit, setOutfit] = useState<OutfitName>("uniform");
  const angleRef = useRef(0);
  const outfitRef = useRef<OutfitName>("uniform");
  const loopingRef = useRef<PixelActionName>("idle");
  const expressionRef = useRef<ExpressionName>("normal");
  useEffect(() => {
    angleRef.current = angle;
    loopingRef.current = looping;
    expressionRef.current = expression;
    outfitRef.current = outfit;
  }, [angle, looping, expression, outfit]);

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      const draft = JSON.parse(saved) as Draft;
      if (draft.base === defaultDesignJson) {
        setDesign(draft.design);
      }
    }
  }, []);
  /** 改造型的同时写入草稿。写入放在 setDesign 的更新函数里，连续修改时每次都基于最新的造型。 */
  const changeDesign: DesignChange = (change) => {
    setDesign((current) => {
      const next = change(current);
      const draft: Draft = { base: defaultDesignJson, design: next };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return next;
    });
  };

  useEffect(() => {
    const container = mount.current!;
    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    renderer.setSize(width, height, false);
    renderer.setClearColor(0, 0);
    const canvas = renderer.domElement;
    canvas.style.imageRendering = "pixelated";
    container.appendChild(canvas);
    const observer = new ResizeObserver(() => {
      const scale = Math.max(
        1,
        Math.floor(Math.min(container.clientWidth / width, container.clientHeight / height)),
      );
      canvas.style.width = width * scale + "px";
      canvas.style.height = height * scale + "px";
    });
    observer.observe(container);

    const scene = new Scene();
    const camera = createPixelCamera(width, height);
    stage.current = { scene, camera };
    const view = createModelView({
      column: modelColumn.current!,
      frame: modelFrame.current!,
      scene,
      pixelCamera: camera,
    });
    modelView.current = view;

    // 脚底投影处画一个椭圆影子。
    const ink = createInk(camera, width, height, new Vector3(0, 0, 0));
    let previous = performance.now(),
      time = 0;
    renderer.setAnimationLoop((now) => {
      time += Math.min(0.06, (now - previous) / 1000);
      previous = now;
      const model = character.current!;
      model.root.rotation.y = (angleRef.current * Math.PI) / 180;
      model.animate(time);
      ink.render(renderer, scene);
      view.render();
    });
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      stage.current = null;
      modelView.current = null;
      view.dispose();
      ink.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);
  // 造型一变就换一个新角色，接着穿当前的衣服、播放当前的循环动作和表情。
  useEffect(() => {
    const { scene, camera } = stage.current!;
    const model = createPixelCharacter(camera, design, outfitRef.current);
    model.play(loopingRef.current);
    model.setExpression(expressionRef.current);
    scene.add(model.root);
    character.current = model;
    return () => {
      scene.remove(model.root);
      model.dispose();
      character.current = null;
    };
  }, [design]);

  return (
    <main className="min-h-dvh bg-[#f6f2e9] px-4 py-6 text-[#403731] sm:px-8 md:py-10">
      <div className="mx-auto max-w-[1120px]">
        <header className="mb-5 flex items-end justify-between gap-3 border-b border-[#cfc6b8] pb-4">
          <h1 className="font-serif text-[28px] font-semibold tracking-[.04em] sm:text-[34px]">
            像素店员
          </h1>
        </header>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-2xl border border-[#ccc6b8] bg-[#faf7f0]">
            <div className="grid h-[min(58dvh,510px)] min-h-[290px] grid-cols-2 bg-[#cbd7c3]">
              <div className="relative min-w-0 border-r border-[#b7c4ae]">
                <span className="absolute left-3 top-2 text-xs text-[#5d6b57]">像素结果 64×64</span>
                <div
                  ref={mount}
                  className="flex h-full select-none items-center justify-center overflow-hidden"
                />
              </div>
              <div className="relative min-w-0">
                <div className="absolute inset-x-3 top-2 z-10 flex flex-wrap items-center justify-between gap-1 text-xs text-[#5d6b57]">
                  <span>渲染前的 3D 模型</span>
                  <div className="flex flex-wrap gap-1">
                    {modelViewModes.map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={modelMode === mode}
                        className={`rounded px-1.5 py-0.5 ${modelMode === mode ? selectedButton : "hover:bg-[#b9c7b1]"}`}
                        onClick={() => {
                          setModelMode(mode);
                          modelView.current!.setMode(mode);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-pressed={wireframe}
                      className={`rounded px-1.5 py-0.5 ${wireframe ? selectedButton : "hover:bg-[#b9c7b1]"}`}
                      onClick={() => {
                        setWireframe(!wireframe);
                        modelView.current!.setWireframe(!wireframe);
                      }}
                    >
                      线框
                    </button>
                    {modelMode === "pixel" && (
                      <button
                        type="button"
                        aria-pressed={pixelGrid}
                        className={`rounded px-1.5 py-0.5 ${pixelGrid ? selectedButton : "hover:bg-[#b9c7b1]"}`}
                        onClick={() => setPixelGrid(!pixelGrid)}
                      >
                        像素网格
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={modelColumn}
                  className="flex h-full items-center justify-center overflow-hidden"
                >
                  <div ref={modelFrame} className="relative">
                    {modelMode === "pixel" && pixelGrid && (
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={pixelGridStyle}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex gap-1">
                {views.map((view) => (
                  <button
                    key={view.label}
                    type="button"
                    aria-pressed={angle === view.angle}
                    className={`rounded-md px-2.5 py-1.5 text-sm ${angle === view.angle ? selectedButton : quietButton}`}
                    onClick={() => setAngle(view.angle)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 border-t border-[#e4dccf] px-4 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-20 text-xs text-[#786c60]">循环动作</span>
                {actionNames
                  .filter((name) => pixelActions[name].loop)
                  .map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={looping === name}
                      className={`rounded-md px-2.5 py-1.5 ${looping === name ? selectedButton : quietButton}`}
                      onClick={() => {
                        setLooping(name);
                        character.current?.play(name);
                      }}
                    >
                      {pixelActions[name].label}
                    </button>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-20 text-xs text-[#786c60]">一次性动作</span>
                {actionNames
                  .filter((name) => !pixelActions[name].loop)
                  .map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`rounded-md px-2.5 py-1.5 ${quietButton}`}
                      onClick={() => character.current?.play(name)}
                    >
                      {pixelActions[name].label}
                    </button>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-20 text-xs text-[#786c60]">表情</span>
                {(Object.keys(expressions) as ExpressionName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={expression === name}
                    className={`rounded-md px-2.5 py-1.5 ${expression === name ? selectedButton : quietButton}`}
                    onClick={() => {
                      setExpression(name);
                      character.current?.setExpression(name);
                    }}
                  >
                    {expressions[name].label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-20 text-xs text-[#786c60]">情绪符号</span>
                {(Object.keys(emotes) as EmoteName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`rounded-md px-2.5 py-1.5 ${quietButton}`}
                    onClick={() => character.current?.showEmote(name)}
                  >
                    {emotes[name].label}
                  </button>
                ))}
              </div>
            </div>
            <PaletteComparison
              design={design}
              angle={angle}
              onPick={(palette) => {
                changeDesign((current) => ({
                  ...current,
                  outfits: {
                    ...current.outfits,
                    lolita: {
                      ...current.outfits.lolita,
                      colors: {
                        ...current.outfits.lolita.colors,
                        dress: palette.dress,
                        accent: palette.accent,
                      },
                    },
                  },
                }));
                setOutfit("lolita");
                character.current!.setOutfit("lolita");
              }}
            />
          </section>
          <CharacterEditor
            design={design}
            outfit={outfit}
            onChange={changeDesign}
            onOutfitChange={(name) => {
              setOutfit(name);
              character.current!.setOutfit(name);
            }}
            onReset={() => {
              localStorage.removeItem(DRAFT_KEY);
              setDesign(defaultCharacterDesign);
            }}
          />
        </div>
      </div>
    </main>
  );
}
