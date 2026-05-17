"use client";

import { Badge } from "@/components/ui/badge";

type HomePageHeaderProps = {
  summary?: string;
};

export function HomePageHeader({ summary }: HomePageHeaderProps) {
  const displaySummary = summary ?? "—";

  return (
    <div className="flex items-end justify-between gap-[16px] mt-[18px] mb-[14px] max-[1020px]:flex-col max-[1020px]:items-start">
      <div>
        <h1 className="m-0 text-[18px] font-extrabold tracking-[0.2px]">首页</h1>
      </div>

      <Badge variant="pill" size="default" className="whitespace-nowrap">
        <span className="text-[#6b7480]">一句话：</span>
        <strong className="text-[#2b2f36]">{displaySummary}</strong>
      </Badge>
    </div>
  );
}
