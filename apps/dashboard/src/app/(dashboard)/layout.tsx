import type { ReactNode } from "react";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { getDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { publicDeployment } = await getDeployment();
  return <DashboardNavigation publicDeployment={publicDeployment}>{children}</DashboardNavigation>;
}
