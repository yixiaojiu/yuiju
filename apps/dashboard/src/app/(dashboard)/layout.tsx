import type { ReactNode } from "react";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { getExtensionPages } from "@/extensions/server";
import { getDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { publicDeployment } = await getDeployment();
  const pages = await getExtensionPages();
  const extensionLinks = pages
    .filter((page) => !page.standalone)
    .map((page) => ({
      label: `${page.title} · ${page.character.name}`,
      href: page.href,
    }));
  return (
    <DashboardNavigation publicDeployment={publicDeployment} extensionLinks={extensionLinks}>
      {children}
    </DashboardNavigation>
  );
}
