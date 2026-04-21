"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { key: "home", href: "/", label: "首页" },
  { key: "activity", href: "/activity", label: "动态" },
  { key: "diary", href: "/diary", label: "日记" },
  { key: "logs", href: "/logs", label: "日志" },
  { key: "settings", href: "/settings", label: "设置" },
];

type NavbarProps = {
  showActivity?: boolean;
  showDiary?: boolean;
  showLogs?: boolean;
};

export const Navbar = ({ showActivity = true, showDiary = true, showLogs = true }: NavbarProps) => {
  const pathname = usePathname();
  const baseLinkClass = "rounded-full px-3.5 py-2.5 text-sm transition-colors";
  const activeLinkClass =
    "bg-[#91c4ee]/30 text-[#2b2f36] shadow-[inset_0_0_0_1px_rgba(145,196,238,0.25)]";
  const idleLinkClass = "text-[#6b7480] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]";
  const visibleItems = navItems.filter((item) => {
    if (item.key === "activity") {
      return showActivity;
    }
    if (item.key === "diary") {
      return showDiary;
    }
    if (item.key === "logs") {
      return showLogs;
    }
    return true;
  });

  return (
    <header className="sticky top-0 z-30 flex justify-center border-b border-[#d9e6f5]/80 bg-[#f7fbff]/80 px-3 py-3.5 backdrop-blur-md">
      <nav
        className="inline-flex items-center gap-1.5 rounded-full border border-[#d9e6f5]/90 bg-white/75 p-1.5 shadow-[0_10px_25px_rgba(21,33,54,0.06)]"
        aria-label="主导航"
      >
        {visibleItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${baseLinkClass} ${isActive ? activeLinkClass : idleLinkClass}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
};
