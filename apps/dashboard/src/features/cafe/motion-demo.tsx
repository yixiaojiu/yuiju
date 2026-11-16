"use client";

import { VRMUtils } from "@pixiv/three-vrm";
import { useEffect, useRef, useState } from "react";
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  Timer,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AvatarAnimator } from "./scene/animator";
import { loadAvatar } from "./scene/avatar";
import { BARISTA_MOTION_SPEED } from "./scene/barista";
import { BARISTA_MODEL_URL } from "./scene/character";

/** 循环播放的动作：点击后作为基础动作。 */
const LOOPS = [
  "idle",
  "idle-happy",
  "idle-breathing",
  "idle-weight-shift",
  "idle-standing",
  "idle-look-around",
  "walk",
  "walk-backward",
  "strafe-left",
  "strafe-right",
  "sit-idle",
  "sit-idle-thighs",
];
/** 一次性动作：点击后播放一次，播完回到当前的基础动作。 */
const ONE_SHOTS = [
  "bow",
  "nod",
  "nod-thoughtful",
  "acknowledge",
  "bashful",
  "talk-calm",
  "taking-item",
  "reaching-out",
  "button-pushing",
  "rummaging",
  "pick-eye-level",
  "pick-one-hand",
  "wave",
  "thankful",
  "talk-one-hand",
  "talk-funny",
  "thinking",
  "happy",
  "happy-gesture",
  "sad",
  "pick-up",
  "put-down",
  "bartending",
  "sit-drink",
];

/** 动作测试页：用角色模型逐个播放下载好的 Mixamo 动作，检查套用效果。 */
export function MotionDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<AvatarAnimator | null>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState("idle");

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = NeutralToneMapping;
    container.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color(0x2a221c);
    scene.add(new HemisphereLight(0xfff4e6, 0x6a5848, 1.2));
    const light = new DirectionalLight(0xffffff, 1.5);
    light.position.set(1, 2, 2);
    scene.add(light, new GridHelper(4, 16, 0x8a7560, 0x4a3c30));
    const camera = new PerspectiveCamera(
      35,
      container.clientWidth / container.clientHeight,
      0.05,
      20,
    );
    camera.position.set(0.4, 1.2, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.75, 0);
    controls.update();

    let disposed = false;
    const timer = new Timer();
    async function load() {
      const vrm = await loadAvatar(BARISTA_MODEL_URL);
      if (disposed) {
        VRMUtils.deepDispose(vrm.scene);
        return;
      }
      scene.add(vrm.scene);
      const animator = new AvatarAnimator(vrm);
      await animator.load([...LOOPS, ...ONE_SHOTS]);
      animator.setBase("idle");
      animatorRef.current = animator;
      setReady(true);
      renderer.setAnimationLoop((timestamp) => {
        timer.update(timestamp);
        const deltaSeconds = Math.min(timer.getDelta(), 1 / 30);
        // 和店里一样按她的动作倍率播放，预览到的就是店里的效果。
        animator.update(deltaSeconds * BARISTA_MOTION_SPEED);
        vrm.update(deltaSeconds);
        controls.update();
        renderer.render(scene, camera);
      });
    }
    load();
    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      animatorRef.current?.dispose();
      controls.dispose();
      VRMUtils.deepDispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const button = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-left text-sm ${active ? "bg-[#e9b872] font-bold text-stone-800" : "bg-white/10 text-white hover:bg-white/20"}`;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-4 left-4 w-56 space-y-4 rounded-xl bg-black/60 p-4 backdrop-blur">
        <p className="text-sm font-bold text-white">{ready ? "动作测试" : "正在加载模型和动作…"}</p>
        <div>
          <p className="mb-1 text-xs text-white/50">循环动作</p>
          <div className="flex flex-col gap-1">
            {LOOPS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={!ready}
                onClick={() => {
                  animatorRef.current!.setBase(name);
                  setCurrent(name);
                }}
                className={button(current === name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-white/50">一次性动作</p>
          <div className="flex flex-col gap-1">
            {ONE_SHOTS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={!ready}
                onClick={() => animatorRef.current!.playOnce(name)}
                className={button(false)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
