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
  aimPixelCamera,
  createPixelCamera,
  createPixelCharacter,
  type EmoteName,
  type ExpressionName,
  emotes,
  expressions,
  INNER_SHADE,
  OUTLINE_SHADE,
  type PixelFocus,
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
 * 俯视角的档位（度），和光影喫茶店场景一致。造型细节按 30° 调，其他角度帽子、刘海和脸的相对位置会差一两个像素。
 */
const elevations = [0, 15, 30, 45];
/** 64×64 画面的取景：画面中心比头部中心低 10 个像素。 */
const focus: PixelFocus = { x: 0, z: 0, up: -10 };
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
 * 像素画面的后处理：场景先按像素网格渲染到离屏贴图，再画到屏幕上，同时加上自选色描边（和光影场景的立牌一致），
 * 并在脚底投影到画面上的位置画一个椭圆影子。
 */
function createInk(camera: OrthographicCamera, width: number, height: number) {
  const target = new WebGLRenderTarget(width, height, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(width, height),
  });
  const material = new ShaderMaterial({
    uniforms: {
      source: { value: target.texture },
      depth: { value: target.depthTexture },
      texel: { value: new Vector2(1 / width, 1 / height) },
      shade: { value: OUTLINE_SHADE },
      innerShade: { value: INNER_SHADE },
      // 前后两个部件相距超过 0.1 个世界单位时，在靠后的那一侧画内描边。
      depthGap: { value: 0.1 / (camera.far - camera.near) },
      shadowCenter: { value: new Vector2() },
      shadowRadius: { value: new Vector2(9 / width, 3.5 / height) },
      shadowAlpha: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D source; uniform sampler2D depth; uniform vec2 texel; uniform vec3 shade; uniform vec3 innerShade;
      uniform float depthGap; uniform vec2 shadowCenter; uniform vec2 shadowRadius; uniform float shadowAlpha;
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
            vec2 offset=(vUv-shadowCenter)/shadowRadius;
            c=vec4(vec3(.15,.18,.14),dot(offset,offset)<1.? shadowAlpha : 0.);
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
    /** 相机换了俯角后重新对准脚底的影子；0° 平视时地面看不到，影子藏起来。 */
    aimShadow(visible: boolean) {
      const ground = new Vector3(0, 0, 0).project(camera);
      material.uniforms.shadowCenter.value.set((ground.x + 1) / 2, (ground.y + 1) / 2);
      material.uniforms.shadowAlpha.value = visible ? 0.18 : 0;
    },
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

export function PixelCharacterPreview() {
  const mount = useRef<HTMLDivElement>(null);
  const modelColumn = useRef<HTMLDivElement>(null);
  const modelFrame = useRef<HTMLDivElement>(null);
  const modelView = useRef<ModelView | null>(null);
  const [modelMode, setModelMode] = useState<ModelViewMode>("free");
  const [wireframe, setWireframe] = useState(false);
  const [pixelGrid, setPixelGrid] = useState(true);
  const character = useRef<ReturnType<typeof createPixelCharacter> | null>(null);
  const stage = useRef<{
    scene: Scene;
    camera: OrthographicCamera;
    ink: ReturnType<typeof createInk>;
  } | null>(null);
  const [design, setDesign] = useState(defaultCharacterDesign);
  const [angle, setAngle] = useState(0);
  const [elevation, setElevation] = useState(30);
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
    const camera = createPixelCamera(width, height, focus);
    const ink = createInk(camera, width, height);
    ink.aimShadow(true);
    stage.current = { scene, camera, ink };
    const view = createModelView({
      column: modelColumn.current!,
      frame: modelFrame.current!,
      scene,
      pixelCamera: camera,
    });
    modelView.current = view;

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
  // 换俯角：像素相机重新对准，角色的起伏和情绪符号按相机实际朝向算，跟着变；3D 模型的「同机位」用的也是这台相机。
  useEffect(() => {
    const { camera, ink } = stage.current!;
    aimPixelCamera(camera, width, height, focus, (elevation * Math.PI) / 180);
    ink.aimShadow(elevation > 0);
  }, [elevation]);
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
              <div className="flex items-center gap-1">
                <span className="text-xs text-[#786c60]">俯视角</span>
                {elevations.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={elevation === value}
                    className={`rounded-md px-2.5 py-1.5 text-sm ${elevation === value ? selectedButton : quietButton}`}
                    onClick={() => setElevation(value)}
                  >
                    {value}°
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
