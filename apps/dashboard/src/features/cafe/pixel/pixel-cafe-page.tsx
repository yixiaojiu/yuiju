"use client";

import { useEffect, useRef, useState } from "react";
import { createMockSession } from "../session/mock";
import type { AvatarConfig, CafeSession } from "../session/state";
import { PixelCafeStage, type PixelPrompt } from "./stage/pixel-cafe-stage";
import { PixelHud } from "./ui/pixel-hud";
import { pixelStyle } from "./ui/pixel-panels";

/** 这一阶段不做捏人，玩家用和她同一个像素模型，进店时只带一个名字。 */
const GUEST: AvatarConfig = { presetId: "pixel", colors: {}, accessories: [], name: "客人" };

/**
 * 像素风咖啡馆页面：店门口 → 进店 → 店内。店内状态和玩家操作都经过 CafeSession，
 * 现在用本地假实现。舞台和 session 一起创建、一起释放。
 */
export function PixelCafePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<{ session: CafeSession; stage: PixelCafeStage } | null>(null);
  const [prompt, setPrompt] = useState<PixelPrompt>(null);
  const [inside, setInside] = useState(false);

  useEffect(() => {
    const session = createMockSession();
    const stage = new PixelCafeStage(containerRef.current!, session, setPrompt);
    setWorld({ session, stage });
    return () => {
      stage.dispose();
      session.dispose();
    };
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#1c1412] select-none">
      <div ref={containerRef} className="absolute inset-0" />
      {world && inside && (
        <PixelHud
          session={world.session}
          stage={world.stage}
          prompt={prompt}
          onLeave={() => {
            setInside(false);
            world.session.leave();
          }}
        />
      )}
      {world && !inside && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <div className={`flex w-72 flex-col items-center gap-3 p-6 ${pixelStyle.paper}`}>
            <h1 className="text-xl font-bold tracking-widest">喫茶 ゆいじゅ</h1>
            <p className="text-sm text-[#7a6352]">{world.session.getState().shop.shiftLabel}</p>
            <button
              type="button"
              onClick={() => {
                world.session.enter(GUEST);
                setInside(true);
              }}
              className={`mt-2 w-full py-2 font-bold ${pixelStyle.dark} ${pixelStyle.button}`}
            >
              进店
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
