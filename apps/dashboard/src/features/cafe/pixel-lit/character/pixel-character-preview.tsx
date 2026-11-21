"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Color,
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
import { type PixelActionName, pixelActions } from "./pixel-actions";
import {
  characterSliders,
  createPixelCamera,
  createPixelCharacter,
  type EmoteName,
  type ExpressionName,
  emotes,
  expressions,
  initialCharacterShape,
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
const selectedButton = "bg-[#51453f] text-[#fff9ee]";
const quietButton = "text-[#645a4e] hover:bg-[#e9e1d4]";

export function PixelCharacterPreview() {
  const mount = useRef<HTMLDivElement>(null);
  const character = useRef<ReturnType<typeof createPixelCharacter> | null>(null);
  const [shape, setShape] = useState(initialCharacterShape);
  const [angle, setAngle] = useState(0);
  const [looping, setLooping] = useState<PixelActionName>("idle");
  const [expression, setExpression] = useState<ExpressionName>("normal");
  const angleRef = useRef(0);
  useEffect(() => {
    angleRef.current = angle;
  }, [angle]);
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
    const model = createPixelCharacter(camera);
    character.current = model;
    scene.add(model.root);

    // Sample neighbouring silhouette pixels on the same grid that gets displayed.
    const target = new WebGLRenderTarget(width, height, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthTexture: new DepthTexture(width, height),
    });
    const ground = new Vector3(0, 0, 0).project(camera);
    const ink = new ShaderMaterial({
      uniforms: {
        source: { value: target.texture },
        depth: { value: target.depthTexture },
        texel: { value: new Vector2(1 / width, 1 / height) },
        outline: { value: new Color("#3d2a36") },
        // 前后两个部件相距超过 0.1 个世界单位时，在靠后的那一侧画内描边。
        depthGap: { value: 0.1 / (camera.far - camera.near) },
        shadowCenter: { value: new Vector2((ground.x + 1) / 2, (ground.y + 1) / 2) },
        shadowRadius: { value: new Vector2(9 / width, 3.5 / height) },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `
        uniform sampler2D source; uniform sampler2D depth; uniform vec2 texel; uniform vec3 outline;
        uniform float depthGap; uniform vec2 shadowCenter; uniform vec2 shadowRadius;
        varying vec2 vUv;
        void main(){
          vec4 c=texture2D(source,vUv);
          vec2 dx=vec2(texel.x,0.),dy=vec2(0.,texel.y);
          if(c.a<.5){
            float edge=max(max(texture2D(source,vUv+dx).a,texture2D(source,vUv-dx).a),
              max(texture2D(source,vUv+dy).a,texture2D(source,vUv-dy).a));
            vec2 offset=(vUv-shadowCenter)/shadowRadius;
            if(edge>.5)c=vec4(outline,1.);
            else c=vec4(vec3(.15,.18,.14),dot(offset,offset)<1.? .18 : 0.);
          }else{
            float nearest=min(min(texture2D(depth,vUv+dx).r,texture2D(depth,vUv-dx).r),
              min(texture2D(depth,vUv+dy).r,texture2D(depth,vUv-dy).r));
            if(texture2D(depth,vUv).r-nearest>depthGap)c.rgb=mix(c.rgb,outline,.6);
          }
          gl_FragColor=c;
          #include <colorspace_fragment>
        }`,
    });
    const screen = new Scene(),
      quad = new PlaneGeometry(2, 2);
    const surface = new Mesh(quad, ink);
    surface.frustumCulled = false;
    screen.add(surface);
    const screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    let previous = performance.now(),
      time = 0;
    renderer.setAnimationLoop((now) => {
      time += Math.min(0.06, (now - previous) / 1000);
      previous = now;
      model.root.rotation.y = (angleRef.current * Math.PI) / 180;
      model.animate(time);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, screenCamera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      character.current = null;
      model.dispose();
      quad.dispose();
      ink.dispose();
      target.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);
  useEffect(() => {
    character.current?.applyShape(shape);
  }, [shape]);

  return (
    <main className="min-h-dvh bg-[#f6f2e9] px-4 py-6 text-[#403731] sm:px-8 md:py-10">
      <div className="mx-auto max-w-[1120px]">
        <header className="mb-5 flex items-end justify-between gap-3 border-b border-[#cfc6b8] pb-4">
          <h1 className="font-serif text-[28px] font-semibold tracking-[.04em] sm:text-[34px]">
            像素店员
          </h1>
        </header>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_282px]">
          <section className="overflow-hidden rounded-2xl border border-[#ccc6b8] bg-[#faf7f0]">
            <div
              ref={mount}
              className="relative flex h-[min(58dvh,510px)] min-h-[290px] select-none items-center justify-center overflow-hidden bg-[#cbd7c3]"
            />
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
          </section>
          <section className="rounded-2xl border border-[#d6cebf] bg-[#fcf9f2] p-5">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <SlidersHorizontal size={17} />
                造型
              </h2>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-[#78685b] hover:text-[#44342d]"
                onClick={() => setShape(initialCharacterShape)}
              >
                <RotateCcw size={13} />
                重置
              </button>
            </div>
            <div className="grid gap-5">
              {characterSliders.map(({ key, label, min, max }) => (
                <label key={key} className="grid gap-1.5">
                  <span className="flex items-center justify-between text-sm">
                    {label}
                    <output className="font-mono text-xs tabular-nums text-[#786c60]">
                      {shape[key]}
                    </output>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={shape[key]}
                    className="h-4 w-full cursor-pointer accent-[#876950]"
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      setShape((current) => ({ ...current, [key]: value }));
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
