import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/lib/components/app-shell/index";
import { isPublicDeployment } from "@/lib/public-deployment";
import "./globals.css";

export const metadata: Metadata = {
  title: "悠酱 - 角色自主生活模拟",
  description: "AI 驱动的角色自主生活模拟可视化界面",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 核心逻辑：对外展示环境隐藏内部观测页入口。
  const showInternalPages = !isPublicDeployment();

  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AppShell showInternalPages={showInternalPages} showWebChat={showInternalPages}>
          {children}
        </AppShell>
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
