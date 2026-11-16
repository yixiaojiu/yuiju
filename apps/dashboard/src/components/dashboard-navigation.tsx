"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@yuiju/shared/ui/components/sheet";
import { cn } from "@yuiju/shared/ui/utils";
import {
  Activity,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  House,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  ScrollText,
  Settings,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

type MenuItem = { label: string; icon: LucideIcon; privateOnly?: boolean } & (
  | { href: string; children?: never }
  | { href?: never; children: { label: string; href: string }[] }
);

const menuItems: MenuItem[] = [
  { label: "主页", href: "/", icon: House },
  { label: "活动", href: "/activities", icon: Activity },
  { label: "日程", href: "/calendar", icon: CalendarDays, privateOnly: true },
  { label: "记忆", href: "/memories", icon: BookOpen },
  { label: "日志", href: "/logs", icon: ScrollText, privateOnly: true },
  { label: "埋点", href: "/analytics", icon: ChartNoAxesCombined, privateOnly: true },
  { label: "告警", href: "/alerts", icon: TriangleAlert, privateOnly: true },
  {
    label: "设置",
    icon: Settings,
    privateOnly: true,
    children: [
      { label: "会话", href: "/settings/conversations" },
      { label: "表情收藏", href: "/settings/stickers" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function MenuLinks({
  pathname,
  publicDeployment,
  extensionLinks,
  collapsed = false,
  onNavigate,
  onExpand,
}: {
  pathname: string;
  publicDeployment: boolean;
  extensionLinks: { label: string; href: string }[];
  collapsed?: boolean;
  onNavigate?: () => void;
  onExpand?: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const items: MenuItem[] = extensionLinks.length
    ? [...menuItems, { label: "扩展", icon: Puzzle, children: extensionLinks }]
    : menuItems;
  return items
    .filter((item) => !publicDeployment || !item.privateOnly)
    .map((item) => {
      const Icon = item.icon;
      const active = item.children
        ? item.children.some((child) => isActive(pathname, child.href))
        : isActive(pathname, item.href);
      const className = cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active && !item.children
          ? "bg-accent font-medium text-foreground"
          : active
            ? "font-medium text-foreground hover:bg-accent/60"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                </>
              )}
            </button>
            {!collapsed && expanded && (
              <div className="mt-0.5 ml-[18px] grid gap-0.5 border-l pl-2.5">
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    aria-current={pathname === child.href ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center rounded-lg px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      isActive(pathname, child.href)
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{child.label}</span>
                  </Link>
                ))}
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
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </Link>
      );
    });
}

export function DashboardNavigation({
  children,
  publicDeployment,
  extensionLinks,
}: {
  children: ReactNode;
  publicDeployment: boolean;
  extensionLinks: { label: string; href: string }[];
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-md md:hidden">
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="打开菜单">
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <span className="text-sm font-semibold tracking-wide">yuiju</span>
        </header>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-[260px] max-w-[85vw] gap-0 bg-sidebar"
        >
          <SheetHeader className="h-14 justify-center px-5">
            <SheetTitle className="text-base font-semibold tracking-wide">yuiju</SheetTitle>
          </SheetHeader>
          <nav aria-label="移动端主导航" className="grid gap-0.5 overflow-y-auto px-3 pb-3">
            <MenuLinks
              publicDeployment={publicDeployment}
              extensionLinks={extensionLinks}
              key={pathname}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
          </nav>
        </SheetContent>
      </Sheet>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-14" : "w-[208px]",
        )}
      >
        <div
          className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}
        >
          <span className="text-base font-semibold tracking-wide">{collapsed ? "y" : "yuiju"}</span>
        </div>
        <nav
          id="desktop-navigation"
          aria-label="主导航"
          className={cn(
            "grid flex-1 content-start gap-0.5 overflow-y-auto pb-3",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <MenuLinks
            publicDeployment={publicDeployment}
            extensionLinks={extensionLinks}
            key={pathname}
            pathname={pathname}
            collapsed={collapsed}
            onExpand={() => setCollapsed(false)}
          />
        </nav>
        <div className={cn("shrink-0 border-t p-2", !collapsed && "px-3")}>
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            aria-label={collapsed ? "展开菜单" : "收起菜单"}
            aria-expanded={!collapsed}
            aria-controls="desktop-navigation"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "text-muted-foreground",
              collapsed ? "mx-auto flex" : "w-full justify-start",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose aria-hidden="true" />
                收起
              </>
            )}
          </Button>
        </div>
      </aside>
      <div
        className={cn(
          "min-h-dvh min-w-0 transition-[padding-left] duration-200",
          collapsed ? "md:pl-14" : "md:pl-[208px]",
        )}
      >
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-8 lg:px-10 lg:py-8"
        >
          {children}
        </main>
      </div>
    </>
  );
}
