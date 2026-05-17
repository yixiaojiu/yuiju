import { Suspense } from "react";
import { DiaryClientShell } from "./diary-client-shell";

function DiaryPageFallback() {
  return (
    <div className="rounded-2xl border border-[rgba(217,230,245,0.9)] bg-white/90 px-4 py-8 text-center text-sm text-[#6b7480] shadow-[0_10px_25px_rgba(21,33,54,0.06)]">
      正在加载日记页...
    </div>
  );
}

export default function DiaryPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-[18px] pt-[18px] pb-[36px]">
      <Suspense fallback={<DiaryPageFallback />}>
        <DiaryClientShell />
      </Suspense>
    </main>
  );
}
