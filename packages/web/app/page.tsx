"use client";

import { Info, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";
import { GameScene } from "@/components/game-scene/game-scene";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchHomeSummary, HOME_SUMMARY_ENDPOINT } from "@/lib/api/home";
import { HomeStatusCard } from "./home/home-status-card";
import { HomeWorldCard } from "./home/home-world-card";

export default function HomePage() {
  const { data: homeData, error: homeError } = useSWR(HOME_SUMMARY_ENDPOINT, fetchHomeSummary);

  const status = useMemo(() => {
    return homeData?.status;
  }, [homeData]);

  const plans = useMemo(() => {
    return homeData?.plans;
  }, [homeData]);

  return (
    <main className="max-w-300 mx-auto px-[18px] pt-[18px] pb-[36px]">
      {homeError ? (
        <Alert className="mb-[14px] border-[#f0caca] bg-[#fff3f3] text-[#9a3d3d]" role="alert">
          <TriangleAlert />
          <AlertDescription className="text-[#9a3d3d]">
            首页状态暂时无法读取，请稍后刷新重试。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-[360px_1fr] max-[1020px]:grid-cols-1 gap-[14px] items-start">
        <div className="grid gap-[14px]">
          <HomeStatusCard
            status={status}
            todayActions={homeData?.todayActions}
            inventory={homeData?.inventory}
            plans={plans}
          />
          <HomeWorldCard time={homeData?.world?.time} weather={homeData?.world?.weather} />
        </div>

        <section
          className="w-full min-w-0 overflow-hidden rounded-2xl border border-[#d9e6f5] bg-white/90 shadow-[0_10px_25px_rgba(21,33,54,0.06)] max-[1020px]:order-first"
          aria-labelledby="world-section-title"
        >
          <header className="p-[14px]">
            <h2 id="world-section-title" className="m-0 text-[14px] font-black tracking-[0.2px]">
              世界
            </h2>
          </header>
          <div className="grid gap-3 px-[14px] pb-[14px]">
            <div className="grid gap-2">
              <Alert className="border-[#c7def5] bg-[#f1f7fd] text-[#315b7d]">
                <Info />
                <AlertDescription className="text-[#315b7d]">
                  PC 使用键盘移动，手机直接滑动屏幕。当前只有海岸可以进入。
                </AlertDescription>
              </Alert>
              <Alert className="border-[#ead7a8] bg-[#fff8e7] text-[#795d24]">
                <TriangleAlert />
                <AlertDescription className="text-[#795d24]">
                  所有美术资源都是 AI 生成，有点粗制滥造。
                </AlertDescription>
              </Alert>
            </div>
            <GameScene />
          </div>
        </section>
      </div>
    </main>
  );
}
