"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  House,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MenuItem = { label: string; icon: LucideIcon } & (
  | { href: string; children?: never }
  | { href?: never; children: { label: string; href: string }[] }
);

const menuItems: MenuItem[] = [
  { label: "主页", href: "/", icon: House },
  { label: "活动", href: "/activities", icon: CalendarDays },
  { label: "记忆", href: "/memories", icon: BookOpen },
  { label: "日志", href: "/logs", icon: ScrollText },
];

function MenuLinks({
  pathname,
  publicDeployment,
  collapsed = false,
  onNavigate,
  onExpand,
}: {
  pathname: string;
  publicDeployment: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  onExpand?: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  return menuItems
    .filter((item) => !publicDeployment || item.href !== "/logs")
    .map((item) => {
      const Icon = item.icon;
      const active = item.children
        ? item.children.some(
            (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
          )
        : pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
      const className = cn(
        "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(145,196,238,0.25)]"
          : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      );

      if (item.children) {
        // 未手动切换的分组随当前路由展开。
        const expanded = expandedGroups[item.label] ?? active;
        return (
          <div key={item.label}>
            <button
              type="button"
              aria-expanded={!collapsed && expanded}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={className}
              onClick={() => {
                if (collapsed) {
                  onExpand?.();
                }
                setExpandedGroups((groups) => ({
                  ...groups,
                  [item.label]: collapsed || !expanded,
                }));
              }}
            >
              <Icon aria-hidden="true" className="size-[18px] shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("size-4 transition-transform", expanded && "rotate-180")}
                  />
                </>
              )}
            </button>
            {!collapsed && expanded && (
              <div className="mt-1 grid gap-1 pl-4">
                {item.children.map((child) => {
                  const childActive =
                    pathname === child.href || pathname.startsWith(`${child.href}/`);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={pathname === child.href ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        childActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={pathname === item.href ? "page" : undefined}
          aria-label={collapsed ? item.label : undefined}
          title={collapsed ? item.label : undefined}
          className={className}
        >
          <Icon aria-hidden="true" className="size-[18px] shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </Link>
      );
    });
}

export function DashboardNavigation({
  children,
  publicDeployment,
}: {
  children: ReactNode;
  publicDeployment: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-card focus:p-3 focus:ring-2 focus:ring-ring"
      >
        跳到主要内容
      </a>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-sidebar/95 px-3 backdrop-blur-md md:hidden">
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开菜单"
              className="text-sidebar-foreground"
            >
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <span className="text-sm font-black tracking-[0.08em]">yuiju</span>
        </header>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-[280px] max-w-[85vw] gap-0 border-sidebar-border bg-sidebar"
        >
          <SheetHeader className="h-16 justify-center border-b px-5">
            <SheetTitle className="font-black tracking-[0.08em]">yuiju</SheetTitle>
          </SheetHeader>
          <nav aria-label="移动端主导航" className="grid gap-1.5 overflow-y-auto p-3">
            <MenuLinks
              publicDeployment={publicDeployment}
              key={pathname}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
          </nav>
        </SheetContent>
      </Sheet>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar/95 shadow-[8px_0_24px_rgba(21,33,54,0.05)] backdrop-blur-md transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-[220px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b px-3",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {!collapsed && <span className="pl-2 text-base font-black tracking-[0.08em]">yuiju</span>}
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "展开菜单" : "收起菜单"}
            aria-expanded={!collapsed}
            aria-controls="desktop-navigation"
            onClick={() => setCollapsed(!collapsed)}
            className="text-sidebar-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </Button>
        </div>
        <nav
          id="desktop-navigation"
          aria-label="主导航"
          className="grid gap-1.5 overflow-y-auto p-2"
        >
          <MenuLinks
            publicDeployment={publicDeployment}
            key={pathname}
            pathname={pathname}
            collapsed={collapsed}
            onExpand={() => setCollapsed(false)}
          />
        </nav>
      </aside>
      <div
        className={cn(
          "min-h-dvh min-w-0 transition-[padding-left] duration-200",
          collapsed ? "md:pl-16" : "md:pl-[220px]",
        )}
      >
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl p-5 outline-none sm:p-8 lg:p-10"
        >
          {children}
        </main>
      </div>
    </>
  );
}
