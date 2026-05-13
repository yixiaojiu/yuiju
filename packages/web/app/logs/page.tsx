import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isPublicDeployment } from "@/lib/public-deployment";
import { LogsClientShell } from "./logs-client-shell";

function LogsPageFallback() {
  return (
    <div className="rounded-2xl border border-[rgba(217,230,245,0.9)] bg-white/90 px-4 py-8 text-center text-sm text-[#6b7480] shadow-[0_10px_25px_rgba(21,33,54,0.06)]">
      正在加载日志页...
    </div>
  );
}

export default function LogsPage() {
  if (isPublicDeployment()) {
    notFound();
  }

  return (
    <main className="max-w-[1200px] mx-auto px-[18px] pt-[18px] pb-[36px]">
      <Suspense fallback={<LogsPageFallback />}>
        <LogsClientShell />
      </Suspense>
    </main>
  );
}
