"use client";

import {
  Activity,
  BookOpenText,
  Brain,
  ChartNoAxesCombined,
  ChevronDown,
  FilePenLine,
  FileText,
  House,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { InterfacePreferencesProvider } from "@/lib/components/interface-preferences";
import { cn } from "@/lib/utils";

const NAVIGATION_ITEMS = [
  { key: "home", href: "/", label: "首页", icon: House },
  { key: "chat", href: "/chat", label: "聊天", icon: MessageCircle },
  { key: "activity", href: "/activity", label: "动态", icon: Activity },
  { key: "diary", href: "/diary", label: "日记", icon: BookOpenText },
  { key: "analytics", href: "/analytics", label: "性能", icon: ChartNoAxesCombined },
  { key: "logs", href: "/logs", label: "日志", icon: FileText },
  { key: "memory", href: "/memory", label: "记忆", icon: Brain },
] as const;

const SETTINGS_NAVIGATION_ITEMS = [
  { href: "/settings", label: "常规设置", icon: SlidersHorizontal },
  { href: "/settings/prompts", label: "提示词管理", icon: FilePenLine },
] as const;

interface NavigationLinksProps {
  closeDrawer: boolean;
  collapsed: boolean;
  items: readonly (typeof NAVIGATION_ITEMS)[number][];
}

function NavigationLinks({ closeDrawer, collapsed, items }: NavigationLinksProps) {
  const pathname = usePathname();

  return items.map((item) => {
    const Icon = item.icon;
    const isActive = pathname === item.href;
    const link = (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-[#91c4ee]/30 text-[#2b2f36] shadow-[inset_0_0_0_1px_rgba(145,196,238,0.25)]"
            : "text-[#667791] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]",
        )}
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        {collapsed ? null : <span>{item.label}</span>}
      </Link>
    );

    return closeDrawer ? (
      <SheetClose key={item.href} asChild>
        {link}
      </SheetClose>
    ) : (
      link
    );
  });
}

interface SettingsNavigationProps {
  closeDrawer: boolean;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function SettingsNavigation({
  closeDrawer,
  collapsed,
  expanded,
  onToggle,
}: SettingsNavigationProps) {
  const pathname = usePathname();
  const isActive = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <div>
      <button
        type="button"
        aria-expanded={collapsed ? false : expanded}
        aria-label={collapsed ? "设置" : undefined}
        title={collapsed ? "设置" : undefined}
        onClick={onToggle}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-[#91c4ee]/30 text-[#2b2f36] shadow-[inset_0_0_0_1px_rgba(145,196,238,0.25)]"
            : "text-[#667791] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]",
        )}
      >
        <Settings aria-hidden="true" className="size-[18px]" />
        {collapsed ? null : (
          <>
            <span className="flex-1 text-left">设置</span>
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform", expanded && "rotate-180")}
            />
          </>
        )}
      </button>
      {expanded && !collapsed ? (
        <div className="mt-1 grid gap-1 pl-4">
          {SETTINGS_NAVIGATION_ITEMS.map((item) => {
            const Icon = item.icon;
            const itemActive = pathname === item.href;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={itemActive ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  itemActive
                    ? "bg-[#91c4ee]/25 text-[#2b2f36]"
                    : "text-[#667791] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{item.label}</span>
              </Link>
            );

            return closeDrawer ? (
              <SheetClose key={item.href} asChild>
                {link}
              </SheetClose>
            ) : (
              link
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface AppShellProps {
  children: React.ReactNode;
  showInternalPages: boolean;
  showWebChat: boolean;
}

export function AppShell({ children, showInternalPages, showWebChat }: AppShellProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const settingsRouteActive = pathname === "/settings" || pathname.startsWith("/settings/");
  const [settingsExpanded, setSettingsExpanded] = useState(settingsRouteActive);
  const visibleItems = NAVIGATION_ITEMS.filter((item) => {
    if (item.key === "chat") {
      return showWebChat;
    }

    return (
      showInternalPages ||
      (item.key !== "analytics" && item.key !== "logs" && item.key !== "memory")
    );
  });

  useEffect(() => {
    if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      setSettingsExpanded(true);
    }
  }, [pathname]);

  return (
    <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[#d9e6f5]/90 bg-[#f7fbff]/90 px-3 backdrop-blur-md md:hidden">
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开菜单"
            className="text-[#52647b] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]"
          >
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <span className="ml-2 text-sm font-black tracking-[0.08em] text-[#2b2f36]">yuiju</span>
      </header>

      <SheetContent aria-describedby={undefined}>
        <div className="flex h-16 items-center border-b border-[#d9e6f5] px-5">
          <SheetTitle className="text-base font-black tracking-[0.08em] text-[#2b2f36]">
            yuiju
          </SheetTitle>
        </div>
        <nav className="grid gap-1.5 p-3" aria-label="移动端主导航">
          <NavigationLinks closeDrawer collapsed={false} items={visibleItems} />
          {showInternalPages ? (
            <SettingsNavigation
              closeDrawer
              collapsed={false}
              expanded={settingsExpanded}
              onToggle={() => setSettingsExpanded((expanded) => !expanded)}
            />
          ) : null}
        </nav>
      </SheetContent>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-[#d9e6f5] bg-[#f7fbff]/95 shadow-[8px_0_24px_rgba(21,33,54,0.05)] backdrop-blur-md transition-[width] duration-200 md:flex",
          sidebarCollapsed ? "w-16" : "w-[220px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-[#d9e6f5] px-3",
            sidebarCollapsed ? "justify-center" : "justify-between",
          )}
        >
          {sidebarCollapsed ? null : (
            <span className="pl-2 text-base font-black tracking-[0.08em] text-[#2b2f36]">
              yuiju
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={sidebarCollapsed ? "展开菜单" : "收起菜单"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="text-[#667791] hover:bg-[#91c4ee]/20 hover:text-[#2b2f36]"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </Button>
        </div>
        <nav className="grid gap-1.5 p-2" aria-label="主导航">
          <NavigationLinks closeDrawer={false} collapsed={sidebarCollapsed} items={visibleItems} />
          {showInternalPages ? (
            <SettingsNavigation
              closeDrawer={false}
              collapsed={sidebarCollapsed}
              expanded={settingsExpanded}
              onToggle={() => {
                if (sidebarCollapsed) {
                  setSidebarCollapsed(false);
                  setSettingsExpanded(true);
                  return;
                }
                setSettingsExpanded((expanded) => !expanded);
              }}
            />
          ) : null}
        </nav>
      </aside>

      <div
        className={cn(
          "min-h-dvh min-w-0 transition-[padding-left] duration-200",
          sidebarCollapsed ? "md:pl-16" : "md:pl-[220px]",
        )}
      >
        <InterfacePreferencesProvider>{children}</InterfacePreferencesProvider>
      </div>
    </Sheet>
  );
}
